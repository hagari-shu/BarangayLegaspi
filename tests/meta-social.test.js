import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  deleteFacebookPost,
  deliverMessengerAnnouncement,
  getMetaIntegrationStatus,
  processMessengerWebhook,
  publishFacebookPost,
  sendMessengerText,
  verifyMetaWebhookSignature,
} from '../server/meta-social.js'

const env = {
  META_PAGE_ID: '123456789',
  META_PAGE_ACCESS_TOKEN: 'page-token-test',
  META_APP_SECRET: 'app-secret-test',
  META_WEBHOOK_VERIFY_TOKEN: 'verify-token-test',
  META_GRAPH_API_VERSION: 'v23.0',
}

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

test('Meta integration status separates Facebook publishing from Messenger webhook setup', () => {
  assert.deepEqual(getMetaIntegrationStatus(env), { facebook: true, messenger: true })
  assert.deepEqual(getMetaIntegrationStatus({ ...env, META_APP_SECRET: '' }), { facebook: true, messenger: false })
  assert.deepEqual(getMetaIntegrationStatus({}), { facebook: false, messenger: false })
})

test('Facebook Page posts use the configured Page token without putting it in the URL', async () => {
  let request
  const postId = await publishFacebookPost(
    { title: 'Community meeting', content: 'Saturday at 9 AM.' },
    {
      env,
      fetchImpl: async (url, options) => {
        request = { url, options, params: new URLSearchParams(options.body) }
        return jsonResponse({ id: '123456789_987654321' })
      },
    },
  )

  assert.equal(postId, '123456789_987654321')
  assert.equal(request.url, 'https://graph.facebook.com/v23.0/123456789/feed')
  assert.equal(request.url.includes(env.META_PAGE_ACCESS_TOKEN), false)
  assert.equal(request.params.get('access_token'), env.META_PAGE_ACCESS_TOKEN)
  assert.equal(request.params.get('message'), 'Community meeting\n\nSaturday at 9 AM.')
})

test('Facebook deletion requires Meta to confirm the post was removed', async () => {
  let requestMethod
  await deleteFacebookPost('123456789_987654321', {
    env,
    fetchImpl: async (_url, options) => {
      requestMethod = options.method
      return jsonResponse({ success: true })
    },
  })
  assert.equal(requestMethod, 'DELETE')
  await assert.rejects(
    deleteFacebookPost('123456789_987654321', {
      env,
      fetchImpl: async () => jsonResponse({ success: false }),
    }),
    /did not confirm/,
  )
})

test('Messenger sends only RESPONSE messages through the Page Send API', async () => {
  let request
  const messageId = await sendMessengerText('psid-123', 'Notice text', {
    env,
    fetchImpl: async (url, options) => {
      request = { url, params: new URLSearchParams(options.body) }
      return jsonResponse({ message_id: 'mid.123' })
    },
  })
  assert.equal(messageId, 'mid.123')
  assert.equal(request.url, 'https://graph.facebook.com/v23.0/123456789/messages')
  assert.equal(request.params.get('messaging_type'), 'RESPONSE')
  assert.deepEqual(JSON.parse(request.params.get('recipient')), { id: 'psid-123' })
})

test('Messenger delivery uses only eligible opt-ins and reports partial failures', async () => {
  const attempted = []
  const result = await deliverMessengerAnnouncement(
    { title: 'Notice', content: 'Text' },
    {
      async listEligibleMessengerSubscribers(since, until) {
        assert.equal(Date.parse(since), 1_000_000 - 24 * 60 * 60 * 1000)
        assert.equal(Date.parse(until), 1_000_000)
        return [{ psid: 'eligible-1' }, { psid: 'eligible-2' }]
      },
      async recordMessengerAnnouncementDelivery() {},
    },
    {
      env,
      now: 1_000_000,
      fetchImpl: async (_url, options) => {
        const recipientId = JSON.parse(new URLSearchParams(options.body).get('recipient')).id
        attempted.push(recipientId)
        return recipientId === 'eligible-1'
          ? jsonResponse({ message_id: 'mid.1' })
          : jsonResponse({ error: { message: 'Outside the permitted messaging window.' } }, 400)
      },
    },
  )
  assert.deepEqual(attempted.sort(), ['eligible-1', 'eligible-2'])
  assert.deepEqual(result, { status: 'partial', eligible: 2, sent: 1, failed: 1 })
})

test('Messenger retractions target only eligible recipients of the original announcement', async () => {
  let sourceAnnouncementId
  let sentAnnouncementId
  const result = await deliverMessengerAnnouncement(
    { id: 'retraction-id', title: 'Correction', content: 'Updated details' },
    {
      async listEligibleMessengerAnnouncementRecipients(announcementId, since, until) {
        sourceAnnouncementId = announcementId
        assert.equal(Date.parse(since), 1_000_000 - 24 * 60 * 60 * 1000)
        assert.equal(Date.parse(until), 1_000_000)
        return [{ psid: 'original-recipient' }]
      },
      async listEligibleMessengerSubscribers() {
        assert.fail('Retractions must not query all opted-in subscribers.')
      },
      async recordMessengerAnnouncementDelivery({ announcementId }) {
        sentAnnouncementId = announcementId
      },
    },
    {
      env,
      now: 1_000_000,
      recipientAnnouncementId: 'original-id',
      fetchImpl: async () => jsonResponse({ message_id: 'mid.correction' }),
    },
  )
  assert.equal(sourceAnnouncementId, 'original-id')
  assert.equal(sentAnnouncementId, 'retraction-id')
  assert.deepEqual(result, { status: 'sent', eligible: 1, sent: 1, failed: 0 })
})

test('Messenger delivery reports when no eligible opted-in recipients exist', async () => {
  const result = await deliverMessengerAnnouncement(
    { title: 'Notice', content: 'Text' },
    { async listEligibleMessengerSubscribers() { return [] } },
    { env, now: 1_000_000 },
  )
  assert.deepEqual(result, {
    status: 'skipped',
    eligible: 0,
    sent: 0,
    failed: 0,
    reason: 'No opted-in subscribers have an open 24-hour messaging window.',
  })
})

test('Messenger consent keywords subscribe and unsubscribe the Page-scoped contact', async () => {
  const changes = []
  const replies = []
  const store = {
    async upsertMessengerSubscriber(value) { changes.push(value) },
    async recordMessengerContact(value) { changes.push({ ...value, optedIn: false }) },
  }
  const result = await processMessengerWebhook({
    object: 'page',
    entry: [{
      id: env.META_PAGE_ID,
      messaging: [
        { sender: { id: 'psid-123' }, timestamp: 1_000_000, message: { text: 'SUBSCRIBE' } },
        { sender: { id: 'psid-123' }, timestamp: 1_100_000, message: { text: 'STOP' } },
        { sender: { id: env.META_PAGE_ID }, timestamp: 1_200_000, message: { text: 'Echo', is_echo: true } },
      ],
    }],
  }, store, {
    env,
    fetchImpl: async (_url, options) => {
      replies.push(JSON.parse(new URLSearchParams(options.body).get('message')).text)
      return jsonResponse({ message_id: `mid.${replies.length}` })
    },
  })
  assert.equal(result, 2)
  assert.deepEqual(changes.map(({ optedIn }) => optedIn), [true, false])
  assert.match(replies[0], /subscribed/i)
  assert.match(replies[1], /unsubscribed/i)
})

test('Meta webhook signature verification rejects altered payloads and malformed signatures', () => {
  const body = Buffer.from('{"object":"page"}')
  const signature = `sha256=${createHmac('sha256', env.META_APP_SECRET).update(body).digest('hex')}`
  assert.equal(verifyMetaWebhookSignature(body, signature, env.META_APP_SECRET), true)
  assert.equal(verifyMetaWebhookSignature(Buffer.from('{"object":"other"}'), signature, env.META_APP_SECRET), false)
  assert.equal(verifyMetaWebhookSignature(body, 'sha1=bad', env.META_APP_SECRET), false)
})
