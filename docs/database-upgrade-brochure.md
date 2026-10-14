# A More Reliable Database for Barangay Legaspi

## A practical upgrade, built around the system we already have

Barangay Legaspi's application already supports PostgreSQL, and its Render deployment configuration already connects the Laravel API to an existing Singapore PostgreSQL database. The proposed work is therefore a **capacity, reliability, backup, and rollout review**—not an automatic move to a different database provider.

## Why review the database now?

- Keep resident, staff, request, and administrative records in a managed relational database.
- Check whether current capacity and storage match real usage.
- Confirm that backups can actually be restored before relying on them.
- Improve operational readiness before directing more application traffic to the Laravel API.

## What it may cost

**Planning allowance only: approximately US$20–40 per month for the database.**

This is not a vendor quote or a verified upgrade price. The current database's plan, size, backup options, and account billing are not visible from the code workspace. The actual incremental cost could be **US$0** if the existing plan is sufficient, or more than this allowance if a larger plan or additional services are required.

Before approving a budget, an authorized account owner should check the database's current plan and projected upgrade price in the Render dashboard. Also check whether a separate paid API service, backup retention, or extra storage is needed; those costs are not included in the database-only allowance.

## Recommended, careful approach

1. Check current usage, plan, and billing in Render.
2. Make and verify a restorable backup.
3. Test the existing schema and API against a staging copy.
4. Upgrade database capacity only if measurements or operational needs justify it.
5. Test resident, staff, and administrator workflows before changing production traffic.
6. Keep a documented rollback path and monitor service health after the change.

## What this does not promise

- No exact price until the Render account is checked.
- No production database change or deployment is included in this proposal.
- A database tier upgrade alone does not switch the public portal from Node/Express to Laravel.
- A backup is not considered reliable until a restore has been tested.

## Decision needed before implementation

Have the Render account owner confirm the current database plan, storage used, backup/restore options, and the displayed price for any proposed change. Then approve the budget and a maintenance window.

For the technical runbook, see [Database Upgrade and Cutover Manual](./database-upgrade-manual.md).
