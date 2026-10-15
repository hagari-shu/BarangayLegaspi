import { createHmac, timingSafeEqual } from 'node:crypto'

const GRAPH_TIMEOUT_MS = 10_000
const MESSENGER_WINDOW_MS = 24 * 60 * 60 * 1000
const MESSENGER_SEND_CONCURRENCY = 5
let messengerDeliveryPersistenceQueue = Promise.resolve()

function persistMessengerAnnouncementDelivery(store, delivery) {
  const save = messengerDeliveryPersistenceQueue.then(() => store.recordMessengerAnnouncementDelivery(delivery))
  messengerDeliveryPersistenceQueue = save.catch(() => {})
  return save
}

export function getMetaIntegrationStatus(env = process.env) {
  const facebook = Boolean(env.META_PAGE_ID && env.META_PAGE_ACCESS_TOKEN && env.META_GRAPH_API_VERSION)
  return {
    facebook,
    messenger: facebook && Boolean(env.META_APP_SECRET && env.META_WEBHOOK_VERIFY_TOKEN),
  }
}

const getGraphUrl = (path, env) => {
  const version = String(env.META_GRAPH_API_VERSION || '')
  if (!/^v\d+\.\d+$/.test(version)) {
    throw new Error('Meta Graph API version is not configured.')
  }
  return `https://graph.facebook.com/${version}/${path}`
}

async function graphRequest(path, { method = 'POST', params, env = process.env, fetchImpl = fetch } = {}) {
  const url = getGraphUrl(path, env)
  const body = new URLSearchParams({ ...params, access_token: env.META_PAGE_ACCESS_TOKEN })
  const response = await fetchImpl(url, {
    method,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `Meta Graph API returned HTTP ${response.status}.`)
  }
  return data
}

export async function publishFacebookPost({ title, content }, options = {}) {
  const env = options.env || process.env
  if (!getMetaIntegrationStatus(env).facebook) {
    throw new Error('Facebook Page publishing is not configured.')
  }
  const result = await graphRequest(`${encodeURIComponent(env.META_PAGE_ID)}/feed`, {
    ...options,
    params: { message: `${title}\n\n${content}` },
  })
  if (typeof result.id !== 'string' || !result.id) {
    throw new Error('Meta did not return a Facebook post ID.')
  }
  return result.id
}

export async function deleteFacebookPost(postId, options = {}) {
  const env = options.env || process.env
  if (!getMetaIntegrationStatus(env).facebook) {
    throw new Error('Facebook Page publishing is not configured.')
  }
  const result = await graphRequest(encodeURIComponent(postId), {
    ...options,
    method: 'DELETE',
    params: {},
  })
  if (result.success !== true) {
    throw new Error('Meta did not confirm the Facebook post deletion.')
  }
}

export async function sendMessengerText(recipientId, text, options = {}) {
  const env = options.env || process.env
  if (!getMetaIntegrationStatus(env).messenger) {
    throw new Error('Messenger is not configured.')
  }
  const result = await graphRequest(`${encodeURIComponent(env.META_PAGE_ID)}/messages`, {
    ...options,
    params: {
      recipient: JSON.stringify({ id: recipientId }),
      messaging_type: 'RESPONSE',
      message: JSON.stringify({ text }),
    },
  })
  if (typeof result.message_id !== 'string' || !result.message_id) {
    throw new Error('Meta did not confirm the Messenger message.')
  }
  return result.message_id
}

export async function deliverMessengerAnnouncement(announcement, store, options = {}) {
  const now = options.now ?? Date.now()
  const since = new Date(now - MESSENGER_WINDOW_MS).toISOString()
  const until = new Date(now).toISOString()
  const subscribers = options.recipientAnnouncementId
    ? await store.listEligibleMessengerAnnouncementRecipients(options.recipientAnnouncementId, since, until)
    : await store.listEligibleMessengerSubscribers(since, until)
  const outcomes = { status: 'sent', eligible: subscribers.length, sent: 0, failed: 0 }
  if (subscribers.length === 0) {
    return { ...outcomes, status: 'skipped', reason: 'No opted-in subscribers have an open 24-hour messaging window.' }
  }

  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < subscribers.length) {
      const subscriber = subscribers[nextIndex]
      nextIndex += 1
      try {
        await sendMessengerText(
          subscriber.psid,
          `${announcement.title}\n\n${announcement.content}`,
          options,
        )
        await persistMessengerAnnouncementDelivery(store, {
          announcementId: announcement.id,
          psid: subscriber.psid,
          sentAt: new Date(now).toISOString(),
        })
        outcomes.sent += 1
      } catch (error) {
        outcomes.failed += 1
        console.error('Messenger announcement delivery failed', error.message)
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(MESSENGER_SEND_CONCURRENCY, subscribers.length) },
    worker,
  ))
  if (outcomes.failed > 0) outcomes.status = outcomes.sent > 0 ? 'partial' : 'failed'
  return outcomes
}

export function verifyMetaWebhookSignature(rawBody, signature, appSecret) {
  if (!Buffer.isBuffer(rawBody) || !appSecret || typeof signature !== 'string') return false
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signature)
  if (!match) return false
  const expected = createHmac('sha256', appSecret).update(rawBody).digest()
  const provided = Buffer.from(match[1], 'hex')
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

export async function processMessengerWebhook(payload, store, options = {}) {
  if (payload?.object !== 'page' || !Array.isArray(payload.entry)) return 0
  let processed = 0
  for (const entry of payload.entry) {
    for (const event of entry.messaging || []) {
      const psid = event.sender?.id
      if (typeof psid !== 'string' || !psid || psid === entry.id || event.message?.is_echo) continue
      const timestamp = Number(event.timestamp)
      const lastMessageAt = new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString()
      const text = String(event.message?.text || '').trim().toLowerCase()
      if (text === 'subscribe' || text === 'subscribe announcements') {
        await store.upsertMessengerSubscriber({ psid, optedIn: true, lastMessageAt })
        await sendMessengerText(
          psid,
          'You are subscribed to Barangay Legaspi announcements on Messenger. You can opt out anytime by sending STOP.',
          options,
        )
      } else if (text === 'stop' || text === 'unsubscribe') {
        await store.upsertMessengerSubscriber({ psid, optedIn: false, lastMessageAt })
        await sendMessengerText(psid, 'You have been unsubscribed from announcement messages.', options)
      } else {
        await store.recordMessengerContact({ psid, lastMessageAt })
        if (event.message?.text || event.postback) {
          await sendMessengerText(
            psid,
            'To receive Barangay Legaspi announcements here, reply SUBSCRIBE. Reply STOP anytime to opt out.',
            options,
          )
        }
      }
      processed += 1
    }
  }
  return processed
}
