# Barangay Legaspi User Manual

This guide explains the resident portal, Staff Portal, resident registry, and administrator portal. Labels may differ slightly when Filipino is selected or when the application is updated.

## Important privacy and availability notice

The application code includes resident-data encryption, but those changes have **not been deployed or verified in the live service**. The current managed database is on a Free plan whose Recovery page reports backups unavailable. Do not assume that existing or newly entered live registry data is encrypted at the application layer or recoverable from backup.

Until the system administrator confirms that encryption is deployed and a protected database backup has been successfully restored in an isolated environment:

- Do not import real resident lists or add new real resident records to an unapproved environment.
- Use only the official, authorized live portal and follow barangay privacy and records-handling procedures.
- Never send resident names, birth dates, household identifiers, addresses, source scans, passwords, MFA codes, or encryption keys through chat, email, screenshots, or support tickets.
- Report an unavailable service to the system administrator; do not switch to a local JSON file or another API as a workaround.

This application is not an emergency dispatch service. For immediate danger or urgent assistance, use the barangay's established emergency channels.

## 1. Choose your role

- **Resident:** create and manage your account, submit service requests, and follow their status.
- **Staff:** review resident accounts, process service requests, and maintain the staff-only resident registry when authorized.
- **Administrator:** review resident and account records, with a narrowly scoped emergency workflow. The Admin Portal no longer displays system-wide statistics or service-request monitoring; Staff retains its service-request queue.

Use your own account only. Do not share passwords, sessions, or authenticator codes. Sign out when finished, especially on a shared device.

## 2. Resident account

### Register

1. Open the Barangay Legaspi portal and choose **Register as Resident**.
2. Complete the required identity, contact, address, and zone fields. Add household information only where requested.
3. Choose a strong, unique password and submit the form.
4. A new account is pending until authorized Staff review it. A pending account cannot use protected portal features.
5. If the information cannot be verified or is incomplete, contact the barangay office through its established channel and ask how to correct or support the registration.

Account registration is not the same as entry into the staff resident registry. Approval of an account does not by itself certify a census or household-roster record.

### Sign in and account access

1. Sign in using your registered email or mobile number and password.
2. If the account is pending, rejected, inactive, or suspended, follow the displayed instructions or contact the barangay office. Do not repeatedly retry passwords.
3. Use **Forgot password** only if the configured recovery service is available. Password-reset delivery has not been verified for every deployment. If no reset instructions arrive, contact the barangay office instead of sending your password to anyone.
4. Use **Settings** to review available security controls. If MFA is enabled, keep authenticator and recovery codes private and store recovery codes securely.

### Staff invitation

Staff accounts are issued by an authorized deployment operator, not created through resident registration or the Admin/Staff portals. Open the invitation link on the official HTTPS site within 24 hours, enter your name, and choose a strong password. The link works once; if it expires or has already been used, contact the system operator for a new one. Do not forward or post the invitation link, and never send your password to the operator.

### Profile, requests, and status

- Open **Profile** to review or edit available contact and address details. Save changes and check for a success or error message.
- Open **Requests** and choose the service type. Complete the required purpose and other requested fields, then submit.
- Check **Requests** or **Request history** for the current status and staff follow-up. If staff request more information, enter the requested follow-up in the portal.
- A submitted request is not proof that a document has been issued or released. Follow the status and any instructions from the barangay.

Events, payments, and notifications may show empty states. The portal does not currently provide a verified payment workflow, automatic event publishing, or guaranteed notifications. Do not interpret a screen or empty list as proof that a payment was made, an event was scheduled, or a message was delivered.

## 3. Staff Portal

Only use Staff Portal functions for authorized barangay work. Resident account approvals and registry records are separate work queues.

### Monitor system activity

The Staff Portal opens directly to **Resident registry**. Its overview and dashboard-summary screens have been removed. Use **Requests** for the service-request queue, and use the remaining Resident records and Service operations links for authorized work. Administrator settings, audit-log access, and backup/restore remain restricted to authorized Admin accounts.

The Admin portal remains a separate, role-protected area and is no longer linked from inside the Staff Portal. Authorized Admin accounts continue to be directed to the Admin portal when they sign in.

### Review resident accounts

1. Sign in with an authorized Staff account and open **Resident account approvals**.
2. Review the submitted information using the barangay's approved verification procedure.
3. Approve only when eligibility and the submitted details have been checked. Reject or request correction according to barangay policy.
4. Verify that the displayed status changed. If it did not, report the error; do not assume the action succeeded.

For an authorized official roster containing only Male/Female values, the deployment operator can run the local roster preflight before a staging import. Missing or unclear values must be corrected from the official source or left for review; never infer a value from a name or other personal detail.

Administrators cannot approve, reject, or edit resident accounts, even while emergency access is active.

### Process service requests

1. Open the Staff Portal and go to the request queue.
2. Use the available status tabs, search, and filters to find the request.
3. Review the request and supporting information. Change the status only after taking the corresponding action under barangay procedure.
4. If information is missing, use the available **Needs information** action and provide a clear request for follow-up.
5. Confirm the status/history reflects the change. The portal does not treat approval as proof that a request is complete or a document has been released.

#### Manually archive closed requests

Authorized Staff may manually archive up to 500 **Approved** or **Rejected** requests at a time from the queue archive panel. This is not automatic: confirm the records are no longer needed in the active queue before archiving. Each batch receives a unique archive copy, the archived requests leave the active queue, and any remaining closed requests can be archived in a later run. Archive access is restricted and audited. Use **Restore** on an archive to return records that do not already exist in the active database; conflicting records are skipped, and the archive copy is retained. An archived **Approved** status is only a workflow status and does not prove a document was released or a service was completed.

### Use the resident registry

The **Resident registry** is a staff-only roster separate from resident login accounts.

#### Search and filter

The registry landing view shows Zone 1–7 only, with each zone's active, verified resident count. Select a zone to open its pop-up; the resident list displays only birthdate and calculated age, not resident names. Use **Edit record** to change a record. The editor keeps stored names hidden unless a staff member enters a replacement name, and supports updating other registry fields. Age is calculated from the birthdate and cannot be edited separately. Changes are validated, encrypted according to the configured storage adapter, and audited by field name without copying resident values to the audit log. The zones are views of the same secure registry, not separate copies. The registry and demographic counts are distinct from the number of resident login accounts.

#### Download an Excel-ready roster

1. Apply the desired search and filters, then select **Download Excel-ready CSV**. Confirm the download only if you are authorized to handle the matching resident records.
2. The export includes all records matching the current filters (not only the visible page), up to 10,000 records. It is sorted by Zone, Household, last name, then first name; each resident is one row with clear columns for their registry fields.
3. Open the `.csv` file in Excel and use its header filters or save a working copy in an approved location. The export is audited by count, grouping, and filter-presence flags; resident values are not copied into the audit log. Keep the file in approved storage and do not share it outside authorized work.
4. Add filters and export again if the matching set exceeds 10,000 records. Do not remove records from the source roster just to fit an export.

#### Add one record manually

1. Select **Add a resident for verification**.
2. Enter the resident's first and last name and choose **Male** or **Female** only when supported by the authorized source. Add birth date, Household, zone, Marital status, Occupation, and source reference only when supported by an authorized source and necessary for the registry. Household is a plain organizational value, not a household identifier.
3. Save the record. It is added as **Pending verification**, not as a confirmed census record.
4. If possible matching records appear, compare them carefully with the official source before proceeding. Do not create a duplicate just to bypass the warning.
5. Keep the record pending until it has been checked against the approved source. If the source is unclear or counts do not reconcile, stop and refer the discrepancy to the responsible records officer.

#### Import a CSV

1. Obtain authorization to use the source list. Reconcile its scope and totals before preparing a file. Do not upload scans or infer unreadable information.
2. In the registry, select **Import reviewed CSV**, then **Download CSV template**.
3. Prepare a UTF-8 CSV with the template's exact headers:
   `firstName,lastName,birthDate,sex,household,zone,maritalStatus,occupation,sourceReference`
4. First and last name and a `Male` or `Female` value are required. Other fields are optional. Use `YYYY-MM-DD` for a known birth date; zone must be 1–7. Quote fields containing commas and escape quotes using normal CSV rules.
5. Upload a `.csv` file no larger than 1 MB and containing no more than 500 records. Preview the file and inspect the displayed rows and validation errors. The preview displays only the first 10 records, so validate the complete source file separately before import.
6. If possible matches are reported, review them before confirming. Cancel if the match is uncertain or the source has not been reconciled. Confirmation imports the rows as pending; it does not verify them.
7. After import, review each record against its source before marking it verified.

Import errors must be corrected in the source file and previewed again. Do not remove fields or records simply to force an import to pass.

#### Scan paper pages on this device

1. Open **Import reviewed CSV**, then **Scan paper forms locally**. Choose existing images, use the phone's **Choose or photograph pages** control, or select **Open camera** for a live rear-camera preview and **Capture page** for each page. Live camera access requires HTTPS (or localhost on the same device) and browser camera permission. On a phone, use the secure HTTPS deployment/preview URL and allow camera access when prompted. If the camera is unavailable, use the phone camera picker or an existing image instead. Up to 10 JPEG, PNG, or WebP pages are accepted at a time; each image must be 10 MB or smaller and the selection must total no more than 30 MB.
2. Select **Read text from selected pages** and wait for local OCR to finish. The scanner runs in this browser using OCR files served by the application; the image itself is not sent to an OCR provider or uploaded by this feature. Captured images remain in browser memory. **Close camera** stops the live camera; **Clear scan and draft** also stops it and clears the in-memory images and text.
3. Compare the preview and recognized text with the original page. OCR can omit, alter, or misread handwriting. It does not identify people or automatically fill resident fields.
4. Add one row for each person you have checked against the original. Enter names and only other necessary, legible details. Use the source-reference field to note a page or line, not additional personal information.
5. Choose **Male** or **Female** only when supported by the source, then check **I checked these details against the original document** for each row. Import remains disabled until all rows have first and last names, a sex value, and have been checked.
6. Review any duplicate warnings. Import only when the possible matches have been checked; otherwise return to editing or clear the scan. Imported records remain pending verification.
7. Select **Clear scan and draft** when finished. Closing the scanner or browser also clears its in-memory image and text state. The original document and OCR text are not stored by the scanner; resident fields are sent to the registry only when the staff member explicitly imports the checked rows.

The scanner accepts image files, not PDFs. Convert or photograph a page only using an approved, secure device and procedure. Do not upload sensitive scans to public conversion or OCR sites. For difficult handwriting, use the existing authorized manual-entry or reviewed-CSV process instead; never guess a name or use OCR output as proof.

#### Verify and maintain a record

- Select **Mark verified** only after comparing the record with the approved source. Confirm the prompt.
- Select **Flag for review** when a record needs further checking. A flagged record is not verified.
- Use the record-status control only for a documented, authorized status change. Confirm the prompt and check the resulting status.
- Verified population totals include only records that are both **Active** and **Verified**. Pending, needs-review, inactive, deceased, or archived records do not count as active verified population.
- Treat demographic totals as operational summaries, not as proof that a source roster is complete.

Browser printing is disabled until a managed office print service is configured and tested. The Excel-ready CSV download is a separate, audited staff action; do not use browser print or “Save as PDF” to copy resident information. If the managed print function reports that no job was started, do not assume anything was printed.

### Source-list discrepancies

If a paper list is missing, illegible, duplicated, or its totals do not match the stated source, pause the affected import and report the location and issue to the authorized records supervisor using the approved internal process. Do not put names, birth dates, addresses, full scans, or free-form resident details in an audit note or public message. Do not mark incomplete records verified to make totals match.

## 4. Administrator access and emergency operations

- The Admin portal opens to Resident management. Use **Access** to review user access and audit activity, and **Emergencies** for emergency reports and the narrowly scoped emergency workflow.
- Use **Tab** and **Shift+Tab** to move through controls, **Enter** or **Space** to activate navigation and zone rows, and the visible-on-focus **Skip to main content** link to bypass navigation. Resident and user search filters update as you type; zone sections announce whether they are expanded.
- The Admin portal does not show live system statistics, system-health summaries, or service-request monitoring. These changes do not remove or alter the Staff service-request queue or resident service-request workflows.
- Admin is read-only for account, staff, announcement, and other administrative changes. Use an authorized Staff account for staff duties.
- Emergency access is only for the documented case when authorized Staff are unavailable. It requires the administrator's current password and, when enabled, an authenticator code. State a clear reason, use the access only for its allowed registry-review and request-processing scope, and revoke it as soon as possible. It expires automatically after 20 minutes and is audited.
- Emergency access does not grant account-approval or account-management rights. Do not use another administrator's emergency grant.

## 5. Privacy and safe handling

- Access resident data only when needed for your assigned duties.
- Keep screens, downloads, and authorized source documents away from public view. Do not save roster exports to personal devices or unapproved cloud drives.
- Use only the minimum necessary personal information and approved source records. Keep source documents in the approved restricted location.
- Never place personal data or secrets in filenames, general-purpose notes, screenshots, chat, or tickets.
- Report suspected disclosure, unauthorized access, incorrect records, or loss of a device promptly through the barangay's incident-reporting process.
- If the portal displays an error, stop before retrying sensitive changes and verify whether the action completed.

## 6. Known limitations

- Encryption and migration changes are prepared in application code but have not been verified as live. Contact the system administrator for deployment status before entering or importing real resident roster data.
- The local scanner is an OCR aid, not a transcription or verification service. Use it only where the deployment has the OCR assets installed and the data owner has approved the workflow.
- The currently observed Render Free database reports backups unavailable. Do not assume production data can be restored until a protected backup has been tested.
- Password-reset delivery, browser printing, payment processing, and several empty/optional portal sections are not confirmed operational.
- The user interface and screenshots may change. If a control differs from this guide, follow the live system administrator's approved instructions rather than trying an undocumented workaround.

## Related materials

- [Resident Account Approval Policy](../ACCOUNT_APPROVAL_POLICY.md)
- [Location Policy](../LOCATION_POLICY.md)
- [Database Upgrade and Cutover Manual](./database-upgrade-manual.md)
- [User Manual Screenshot Index](../barangay-legaspi-manual-evidence/SCREENSHOT_INDEX.md)
