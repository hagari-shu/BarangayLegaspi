# A Safer, More Reliable Database for Barangay Legaspi

## A practical upgrade, built around the system we already have

Barangay Legaspi's application already supports PostgreSQL, and its Render deployment configuration already connects the Laravel API to an existing Singapore PostgreSQL database. The proposed work is therefore a **capacity, reliability, backup, and rollout review**—not an automatic move to a different database provider.

**Current status (16 October 2026):** the Render database is Available in Singapore, but is on the Free plan. Its dashboard reports 1 GB storage with about 6.7% used and says backups are unavailable on Free. The Laravel API's health endpoint reported PostgreSQL connectivity, but application readiness, resident-data encryption, and backup restoration have not been verified in production. The encryption changes have not been deployed. No resident lists have been imported as part of this work.

## Why review the database now?

- Keep resident, staff, request, and administrative records in a managed relational database.
- Check whether current capacity and storage match real usage.
- Confirm that protected backups can actually be restored before relying on them.
- Improve operational readiness before directing more application traffic to the Laravel API.
- Encrypt sensitive resident fields in the application and verify access controls before storing identifiable information.

## What it may cost

Provider dashboard prices checked on 16 October 2026 (USD/month; verify the current price and final billing confirmation before purchase):

| Service | Current plan | Paid options displayed |
|---|---|---|
| Render PostgreSQL | Free; backups unavailable | $6 (0.1 CPU, 256 MB RAM); $19 (0.5 CPU, 1 GB RAM); $40 (1 CPU, 2 GB RAM) |
| Render Laravel API | Free; may spin down | $7 (0.5 CPU, 512 MB RAM); $25 (1 CPU, 2 GB RAM) |
| Vercel frontend | Hobby, $0 | Pro displayed at $20 |

The lowest paid Render API + database combination displayed is **$13/month** ($7 + $6), before taxes and usage charges. Using the $19 database option makes the base total **$26/month**; using the $40 option makes it **$47/month**. These are prices observed in the account's dashboards, not a recommendation about capacity or an authorization to upgrade.

Possible additional costs are not included: protected off-site backups/storage and transfer, object storage for optional photo workflows, email/SMS delivery, custom domains, usage overages, and taxes. Vercel Pro is not automatically required for application encryption or resident data storage; confirm usage and organizational requirements first. Staff time for transcribing and independently reconciling paper lists is an operational cost, not a hosting fee.

## Recommended, careful approach

1. Check current usage, plan, and billing in Render.
2. Select recovery-capable backup coverage; the dashboard states that Free databases do not have backups. A paid recovery window is not retroactive.
3. Make and verify a restorable backup in isolated staging before migrations or resident-data imports.
4. Deploy and test application-level encryption, key recovery, and role access controls in staging.
5. Upgrade database capacity only after reviewing the actual usage, backup requirements, plan limits, and written budget approval.
6. Test resident, staff, and administrator workflows before changing production traffic.
7. Import resident information only after an authorized source is reconciled and staff verification steps are ready.
8. Keep a documented rollback path and monitor service health after the change.

## What this does not promise

- Dashboard prices can change; confirm them in the provider account before approval.
- No production database change, plan upgrade, resident-list import, or deployment is included in this proposal.
- A database tier upgrade alone does not switch the public portal from Node/Express to Laravel.
- A Free database backup is unavailable in the current dashboard; a backup is not considered reliable until a restore has been tested.
- Application-level encryption does not retroactively encrypt old backups or prove provider-side encryption and access controls.
- Do not enter identifiable resident information until the encryption deployment, recovery plan, and restore test are complete.

## Decision needed before implementation

Have the Render account owner confirm current plans, recovery features, retention, and final monthly costs. Approve the budget and maintenance window before any paid plan change. Keep resident information out of the database until protected backups, encryption, restore, and verification gates pass.

For the technical runbook, see [Database Upgrade and Cutover Manual](./database-upgrade-manual.md).
