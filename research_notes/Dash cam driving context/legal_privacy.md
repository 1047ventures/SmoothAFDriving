# Legal, Privacy and App Store Rules for Dash Cam Video in an iOS Driving-Score App

Research date: 2026-11-06. Not legal advice. Most US "state-by-state dash cam law" content online comes from dash cam vendors and fleet-software blogs, not legal sources. Anything marked LAWYER below needs a privacy lawyer before launch.

## 1. US: recording public roads, windshield mounts, audio consent, biometrics, CCPA/CPRA, retention and subpoenas

### Takeaway
Recording video of public roads is broadly lawful in the US. The real exposure is in four places: (a) windshield-obstruction rules, which govern where the camera is mounted, (b) **audio**, because in roughly a dozen all-party-consent states recording cabin conversations without consent can be a crime, (c) **face processing**, because even face *detection for blurring* has drawn BIPA class actions and settlements, and (d) cloud copies, which become discoverable and subpoenable evidence the app holds.

### Cited Findings
**Video of public roads and mounting**
- Vendor and fleet guides agree dash cams are legal in all 50 states. The restrictions are about placement and obstruction, not the act of recording. — [ExpertMarket](https://www.expertmarket.com/dash-cams/dash-cam-laws-by-state); [Matrack](https://matrackinc.com/dash-cam-laws-by-states/); [Nexar state guide](https://www.getnexar.com/blog/are-dash-cams-legal-a-state-by-state-guide-to-dash-cam-laws-in-the-usa)
- Examples of mount rules (secondary sources, sometimes inconsistent with each other):
  - California: limited to a 5-sq-in area at the upper center or 7 sq in at the lower corner of the windshield.
  - Indiana: passenger-side bottom corner, at most 4 in square.
  - Georgia: bans nontransparent material that obstructs the view.
  - Washington: one source says windshield mounting is prohibited.
  - Alabama: sources conflict on whether windshield mounting is allowed. — [Matrack](https://matrackinc.com/dash-cam-laws-by-states/); [FreightWaves](https://www.freightwaves.com/checkpoint/dash-cam-laws-by-state/); [Facit](https://facit.ai/insights/dash-cam-laws-by-state)
- Sources consistently recommend a dashboard or behind-the-mirror mount as the safest choice when a state's rule is unclear. — [ExpertMarket](https://www.expertmarket.com/dash-cams/dash-cam-laws-by-state)

**Audio: all-party consent**
- All-party-consent lists vary between 12 and 13 states. One list is CA, DE, FL, IL, MD, MA, MI, MT, NV, NH, OR, PA and WA. Another includes CT instead of DE and OR. MI and NV are described as having exceptions or applying only in some situations. — [Nexar audio laws blog](https://www.getnexar.com/blog/dash-cam-audio-recording-laws); [Nexar privacy by state](https://www.getnexar.com/blog/dash-cam-privacy-laws-by-state)
- Video-only recording inside your own vehicle generally needs no notice in any state. The audio is the regulated part, and illegally recorded audio may be inadmissible while the video stays admissible. — [Nexar audio laws blog](https://www.getnexar.com/blog/dash-cam-audio-recording-laws)
- The common compliance practice is a visible notice, or turning audio off when carrying passengers. — [Nexar audio laws blog](https://www.getnexar.com/blog/dash-cam-audio-recording-laws)

**Biometrics (faces)**
- **YouTube agreed to a $6M BIPA settlement over its Face Blur feature.** The plaintiffs alleged that detecting faces in order to blur them involved scanning face geometry. YouTube denied the allegations. This is the closest analogy to blurring dash cam faces. — [IDTechWire](https://idtechwire.com/youtube-agrees-to-6-million-bipa-settlement-over-face-blur-feature/); [Biometric Update](https://www.biometricupdate.com/202209/blurring-a-face-on-youtube-can-violate-bipa-new-lawsuit)
- Vehicle-camera BIPA cases have moved forward:
  - Lytx paid a $4.25M settlement in January 2025.
  - A Brink's armored-truck camera suit survived a motion to dismiss.
  - An HMD Trucking driver-facing camera suit survived a dismissal argument that scans don't count unless they are used to identify someone.
  - Samsara was sued over its "Camera ID" facial recognition. — [IDTechWire HMD](https://idtechwire.com/illinois-judge-lets-bipa-suit-over-driver-facing-cameras-at-hmd-trucking-move-ahead/); [Bloomberg Law Brink's](https://news.bloomberglaw.com/litigation/driver-advances-brinks-biometric-privacy-suit-over-face-scans); [vLex dashcam BIPA](https://vlex.com/vid/class-action-bipa-lawsuit-907462557)
- Texas CUBI: the AG obtained a $1.4B settlement with Meta in July 2024, the first CUBI action. Only the AG can enforce CUBI, at up to $25,000 per violation. — [Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/meta-settles-texas-biometric-data-lawsuit-for-record-1-4-billion); [ByteBack](https://www.bytebacklaw.com/2024/07/texas-attorney-general-announces-first-cubi-settlement/)

**CCPA/CPRA**
- CPRA "sensitive personal information" includes **precise geolocation** (within a radius of about 1,850 ft) and biometric information **processed to identify** a consumer. Consumers get a right to limit its use, delivered through a "Limit the use of my sensitive personal information" link. — [Securiti](https://securiti.ai/blog/cpra-sensitive-personal-informations/); [CookieYes](https://www.cookieyes.com/blog/cpra-sensitive-personal-information); [Lewis Brisbois](https://lewisbrisbois.com/print/18095)
- The CPRA biometric definition is narrower than the CCPA's: "used or intended to be used" to establish identity, rather than "can be used". — [Lewis Brisbois](https://lewisbrisbois.com/print/18095)

**Retention, subpoenas and litigation holds**
- Nexar's policy says it may disclose data to government and law enforcement "in response to a subpoena, search warrant or court order", or when it believes this is appropriate to address suspected illegal activity. — [Nexar Privacy Policy, Sept 2025](https://www.getnexar.com/privacy)
- Nexar's co-founder has acknowledged that law enforcement could subpoena raw footage and sensor data. — [IEEE Spectrum](https://spectrum.ieee.org/cars-that-think/transportation/sensors/the-ai-dashcam-app-that-wants-to-rate-every-driver-in-the-world)
- The duty to preserve evidence starts when litigation is reasonably anticipated, which after a crash can be immediately. Deleting footage can lead to an adverse-inference instruction: the jury may presume the footage was unfavorable. — [Gary Martin Hays (GA spoliation)](https://www.garymartinhays.com/articles/spoliation-of-evidence-after-a-georgia-car-accident/); [Trial Magazine](https://justice.org/resources/publications/trial-magazine/2019-january/spoliation-in-the-digital-age); [Woods v. Scissons (D. Ariz. 2019), police dashcam](https://law.counselstack.com/opinion/woods-v-scissons-azd-2019); [NatLawReview](https://natlawreview.com/article/preserving-camera-footage-anticipation-litigation)

### Inferences
- **Default audio OFF.** This removes the whole all-party-consent problem, and audio adds little to a smoothness score. If audio is ever added, it should be opt-in with a passenger-notice prompt.
- **Face blurring is not automatically safe under BIPA.** The YouTube settlement shows that detect-to-blur can be pleaded as collecting face geometry. Mitigations, LAWYER to confirm for Illinois and Texas users:
  - blur on-device;
  - never store embeddings or templates;
  - never identify anyone;
  - document a written retention and destruction policy.
- **Plate OCR or matching would be a bigger risk than blurring.** Avoid any feature that reads plates. It turns the app into a mobile license-plate reader, an area with its own state statutes. Those statutes were not researched here.
- **Cloud-stored clips are records the company holds and can be ordered to produce.** Short default retention, user-controlled deletion and an on-device-first design reduce how often the company itself gets subpoenaed. They do not change the user's own duty to preserve after a crash, and LAWYER should confirm how deletion interacts with a litigation hold.
- **The app should not tell users where to mount the camera beyond "not in your line of sight; check your state."** It should not claim that any mount position is legal.

### Gaps
- Primary statutory text for each all-party-consent state was not verified. Lists from vendor blogs conflict, especially on CT, DE, OR, MI and NV.
- **Whether dash cam audio counts as an "oral communication" with a reasonable expectation of privacy** inside a private car is decided state by state in case law. No authoritative source was found. LAWYER.
- **Washington biometric law** (RCW 19.375, and whether My Health My Data covers face data) was not found in the searches. LAWYER.
- The 2024 Illinois amendment SB 2979, which limits BIPA damages to one recovery per person, is believed to exist but was not verified in this research.
- Other comprehensive state privacy laws (VA, CO, CT, TX TDPSA and others), which generally require opt-in consent for sensitive data, were not researched individually.
- No source was found on state license-plate-reader statutes as they apply to private apps.

## 2. EU/UK GDPR: dash cams and third parties; country restrictions; Germany's courts

### Takeaway
In the EU, continuous dash cam recording of public roads usually falls *outside* the household exemption, so the driver is a data controller. The app operator that receives the clips is also a controller or processor with full GDPR duties. Austria, Luxembourg and Portugal are hostile to dash cams. Germany treats them as a data protection violation but allows the footage as accident evidence. The UK ICO's position is similar, and footage shared online or used for work is not "domestic".

### Cited Findings
- The EDPB Guidelines 3/2019 on video devices (v2.0, adopted 29 Jan 2020) interpret the household exemption narrowly, relying on the CJEU's *Ryneš* ruling that recording public space is not purely household activity. The draft said a device must "not [be] constantly recording". — [EDPB Guidelines 3/2019 PDF](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_201903_video_devices_en.pdf); [Hunton summary](https://www.hunton.com/privacy-and-cybersecurity-law-blog/edpb-adopts-guidelines-on-data-processing-through-video-devices); [White & Case on dashcams in the EU](https://whitecase.com/publications/article/dashcams-and-autonomous-vehicles-dodging-legal-landmines-eu)
- **Germany:** the BGH ruled on 15 May 2018 (VI ZR 233/17) that dashcam footage can be **admitted as evidence** in accident-liability cases even though continuous recording conflicts with data protection law. Admissibility is a case-by-case balancing exercise. Short, event-triggered recording is the commonly cited compliant pattern. — [dahag.de](https://www.dahag.de/c/ratgeber/verkehrsrecht/autounfall/dashcams); [mobile.de](https://www.mobile.de/magazin/artikel/dashcam-im-auto-was-ist-erlaubt--30182); [Springer ATZ 2018](https://rd.springer.com/content/pdf/10.1007/s38311-018-0105-9.pdf)
- **Austria:** continuous recording is treated as unauthorized surveillance, with fines reported up to €10,000 (€25,000 for repeat offences). There is no landmark ruling comparable to the BGH decision. — [autorevue.at](https://www.autorevue.at/ratgeber/dashcam-oesterreich-verboten-oder-erlaubt); [learndrivingtheory](https://www.learndrivingtheory.com/en/austria/article/dashcam-legality-austria-data-protection-evidence)
- **Luxembourg:** owning a dash cam is reportedly legal but using one is not. **Portugal:** the data protection authority reportedly treats recording as prohibited in most circumstances. Sources conflict and are mostly commercial or travel sites. — [tyremap](https://tyremap.com/blog/countries-where-dashcams-are-illegal/); [Skoda Storyboard](https://www.skoda-storyboard.com/en/skoda-world/dashboard-cameras-where-its-advisable-to-put-them-away/); [Snooper](https://gb.snooper.eu/blog/can-i-use-my-dash-cam-in-europe/)
- **UK:** dash cam use solely for domestic purposes is exempt. Use for work is not domestic and may require paying the ICO data protection fee. Commentators note the ICO's domestic CCTV guidance follows *Ryneš* for public-space recording. — [Nelsons Law](https://www.nelsonslaw.co.uk/dashcams-gdpr/); [ICO fee self-assessment](https://ICO.ORG.UK/for-organisations/data-protection-fee/self-assessment/y); [Bristows](https://inquisitiveminds.bristows.com/post/102hkp4/surveillance-technologies-in-vehicles-part-1-why-is-a-dashcam-like-a-doorbell); [Information Rights and Wrongs](https://informationrightsandwrongs.com/2021/02/06/dashcams-and-domestic-purposes/)
- Ireland's DPC and Sweden's IMY both say that **publishing footage online** (social media, a wider circle) takes it outside the household exemption. — [Irish DPC guidance](https://collab.dpa.gr/wp-content/uploads/2023/07/dpc-Guidance-for-Drivers-on-the-use-of-Dash-Cams_en.pdf); [IMY](https://www.imy.se/en/individuals/camera-surveillance/video-surveillance-under-the-domestic-purpose-exemption/)

### Inferences
- **Uploading clips to the app's cloud and analysing them is almost certainly not "household" processing for the company.** The operator needs:
  - a lawful basis for processing bystanders' data, most likely legitimate interest, backed by a documented Legitimate Interests Assessment;
  - a DPIA, which is likely mandatory given systematic monitoring of public space;
  - a transparency approach for bystanders, who cannot be notified directly. LAWYER.
- **Safest EU/UK launch posture:** keep video features off or on-device-only in AT, LU and PT, and only accept short event-triggered clips everywhere else. Do not store continuous drive video.
- **Public sharing or leaderboard features showing clips would break the household exemption for the user too.** Keep clips private by default.

### Gaps
- The exact wording of the final EDPB v2.0 text on dashcams was not quoted. Read the PDF before relying on any specific example.
- No current official DPA pages for Austria, Luxembourg or Portugal were retrieved. All findings for those three come from secondary sources, some dated 2018.
- The current ICO dashcam page was not retrieved directly.

## 3. Third-party AI APIs (Gemini, Claude, OpenAI): processing terms, training, disclosures, blurring

### Takeaway
All three providers' **paid** API tiers say customer content is not used for training. All keep abuse-monitoring logs for a limited period: Gemini 55 days, OpenAI 30 days, Anthropic about 30 days (one source says 7). Gemini's **free** tier does train on inputs with human review, and is barred for EEA/UK/CH end users. Apple now explicitly requires disclosing sharing with "third-party AI" and getting explicit permission. Blurring before upload is strongly advisable, and EgoBlur is Apache-2.0 and covers both faces and plates.

### Cited Findings
- **Gemini, unpaid tier:** Google uses submitted content to improve products, and "human reviewers may read, annotate, and process your API input and output". The terms say not to submit sensitive or personal information. **Only Paid Services may be used for apps serving users in the EEA, Switzerland or the UK.** API users must be 18+, and the API may not be used in clients likely to be accessed by under-18s. — [Gemini API Additional Terms](https://aistudio.google.com/docs/terms)
- **Gemini, paid tier:** Google does not use prompts or responses, including uploaded files, to improve its products. It logs prompts and responses for a limited period for abuse detection and legal compliance. — [Gemini API Additional Terms](https://aistudio.google.com/docs/terms)
- That abuse-monitoring log is kept for **55 days** and used only for policy-enforcement models. Zero data retention is pointed to Vertex AI. — [Google abuse monitoring](https://ai.google.dev/gemini-api/docs/abuse-monitoring); [developersdigest tracker](https://www.developersdigest.tech/models/data-retention/google)
- **Anthropic:** commercial and API content is not used for training. Inputs and outputs are deleted within 30 days per the privacy center, though one blog claims this changed to 7 days in Sept 2025, which is unverified. Zero data retention is available by arrangement. — [developersdigest Anthropic](https://www.developersdigest.tech/models/data-retention/anthropic); [unsigned.char](https://unsigned.char.com/blog/anthropic-data-retention-policy/)
- **OpenAI:** API data has not been used for training by default since 1 March 2023. Abuse logs are kept up to 30 days, and zero data retention is available on eligible endpoints. — [AI privacy retention guide (secondary)](https://keyboardmonkey.github.io/vibe-artifacts/llm-data-risks/ai-privacy-retention-guide.html)
- **Apple 5.1.2(i):** "You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so." — [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- **Blurring tools:**
  - EgoBlur (Meta) detects faces and license plates.
  - It is Apache 2.0 for commercial and non-commercial use.
  - It is trained on 622k images with 676k plate boxes.
  - It only locates faces and plates and does not identify them.
  - Its tooling handles PNG, JPEG and MP4. — [EgoBlur on Hugging Face](https://huggingface.co/projectaria/EgoBlur); [Project Aria docs](https://facebookresearch.github.io/projectaria_tools/docs/open_models/egoblur); [arXiv 2308.13093](https://arxiv.org/pdf/2308.13093v2.pdf)
- Nexar says it anonymizes "directly on the User's device, even before the information is sent", but keeps separate **non-anonymized** training data. — [Nexar Privacy Policy](https://www.getnexar.com/privacy)

### Inferences
- **Use only paid or enterprise API tiers, and sign each provider's DPA.** The privacy policy should name the AI subprocessors (or the categories), state what is sent (frames or clips plus telemetry), state that the providers don't train on it, and give their log-retention windows.
- **Under GDPR the AI vendor is a processor and needs an Art. 28 DPA.** Video sent to US providers also needs a transfer mechanism, such as the EU-US Data Privacy Framework or SCCs. LAWYER.
- **Recommended pipeline:** on-device blur of faces and plates (EgoBlur or a Core ML port), then send downsampled keyframes rather than full video, with audio stripped, and keep raw clips local by default. This reduces bystander personal data reaching the AI vendor. Running blur detection on-device also keeps Apple's "collected" definition and the BIPA "collection" theory as narrow as possible, though it does not eliminate the BIPA risk described in section 1.
- **Gemini's 18+ rule matters.** The app's App Store age rating and terms should stay consistent with each provider's age rule.

### Gaps
- Anthropic's and OpenAI's own primary policy pages were not fetched. The figures come from secondary trackers. Verify against the Anthropic Commercial Terms and DPA and OpenAI's data controls docs.
- No source was found on whether any provider has video-specific retention rules, for example Gemini Files API storage of uploaded video, which is believed to be about 48 hours but was not verified.
- The ORB-HD "deface" tool was not found in search. Its license and plate support are unverified.

## 4. Apple App Store Review Guidelines and App Privacy labels

### Takeaway
The relevant rules are:
- 2.5.14: explicit consent plus a visible or audible indicator when recording.
- 2.5.4: background modes only for their intended purposes.
- 5.1.1: privacy policy, consent and purpose strings.
- 5.1.2(i): explicit permission for third-party AI sharing.
- 5.1.2(vi): no marketing use of camera data.
- 1.4 / 1.4.5: physical harm and distraction.

Uploading clips adds the privacy-label types Photos or Videos and possibly Audio Data, on top of the Precise Location the app likely already declares, and Sensitive Info if biometric data is collected.

### Cited Findings
- **2.5.14:** "Apps must request explicit user consent and provide a clear visual and/or audible indication when recording, logging, or otherwise making a record of user activity. This includes any use of the device camera, microphone…" — [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- **2.5.4:** background services may only be used "for their intended purposes: VoIP, audio playback, location, task completion, local notifications, etc." — [Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- **5.1.1(i):** the privacy policy must identify the data collected and all its uses, confirm that third parties give equal protection, and explain retention and deletion and how to revoke consent. **5.1.1(ii):** consent is required even for data that is anonymous, paid features can't depend on granting access, and purpose strings must "clearly and completely describe" the use. — [Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- **5.1.2(ii):** no repurposing of data without further consent. **5.1.2(vi):** data from "depth and/or facial mapping tools (such as ARKit, Camera APIs, or Photo APIs) may not be used for marketing, advertising or use-based data mining, including by third parties." — [Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- **1.4:** an app "that risks physical harm" may be rejected. **1.4.5:** apps should not urge people "to use their devices in a way that risks physical harm". **1.4.4:** apps must not encourage reckless behavior such as excessive speed. — [Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- **Privacy label types:**
  - "Photos or Videos": the user's photos or videos.
  - "Audio Data": "The user's voice or sound recordings".
  - "Precise Location": three or more decimal places.
  - "Sensitive Info": includes "biometric data".
  - "Other User Content". — [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- "Data that is processed only on device is not 'collected'". Data derived from it and then sent off the device must be considered separately. "Collect" means transmitting data off the device so that you or your partners can access it for longer than real-time servicing. Personal data under privacy laws counts as linked to the user. — [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)

### Inferences
- **New labels if clips are uploaded:**
  - Photos or Videos: linked to the user, purpose App Functionality and perhaps Product Personalization.
  - Audio Data: only if audio is kept.
  - Sensitive Info: only if face templates leave the device, which they should not.
  - Third-party AI vendors that receive clips must be reflected in the label answers.
  If the clips are only processed on-device and discarded, no new label is needed.
- **Live AI feedback while driving must not require looking at the screen** (1.4.5). Use voice and post-drive review.
- **Do not plan on continuous background camera capture.** iOS has no "camera" background mode, so background recording through the phone camera is not a supported path. The practical design is ingesting files from an external dash cam, or recording with the app in the foreground. This is an inference from 2.5.4 and general iOS behavior; verify technically.
- **Video sharing needs its own explicit, separate consent screen** (5.1.2(i)) that names the AI vendor before the first upload.

### Gaps
- The guidelines text after section 5.2 was truncated in the fetch. Sections 5.x on kids and on Sign in with Apple were not reviewed.
- **No Apple guidance was found on importing video from an external Wi-Fi dash cam.** The Local Network permission and Wi-Fi accessory rules were not researched.

## 5. Insurance angle: can the video hurt the user? Nexar and BlackVue terms

### Takeaway
Yes. Footage is discoverable evidence, it can show the user at fault, and deleting it after a crash risks spoliation sanctions. Nexar makes insurer sharing user-authorized but keeps law-enforcement disclosure on subpoena or warrant open, retains data "to protect ourselves from any potential disputes", and makes no promise that footage won't be used against users. BlackVue's policy has a "Disclosure for Law Enforcement" section, and a mid-2026 controversy over its public live-view map shows the reputational risk.

### Cited Findings
- **Nexar policy (Sept 2025)** covers images, video, sensor data and GNSS location, and its CCPA section lists audio.
  - Collision reports go to insurers "subject to your authorization" or through a "Report to Insurer" feature.
  - Law-enforcement access is on subpoena, warrant or court order, or when Nexar believes it is appropriate to address suspected illegal activity.
  - Anonymized footage is shared with autonomous-driving and mapping partners, with mapping on by default unless the user opts out.
  - There is no fixed retention period.
  - Data is kept to "protect ourselves from any potential disputes". — [Nexar Privacy Policy](https://www.getnexar.com/privacy)
- Nexar help pages say insurer sharing is "at your discretion". Collision reports can include plates and the other party's insurance information. — [Nexar Help](https://intercom.help/nexar/en/articles/8485517)
- **BlackVue Cloud privacy policy** (effective 1 Aug 2021, Pittasoft): BlackVue is the data controller, and the "Disclosure of Data" section opens with "Disclosure for Law Enforcement". The full text was not retrieved. — [BlackVue Cloud Privacy Policy](https://blackvue.com/pages/cloud-terms-conditions-eng)
- June 2026 reporting: BlackVue's public map let viewers watch live feeds from some users' cameras. BlackVue says cameras default to private, and later versions let users hide a camera's location. — [BlackVue statement](https://media.blackvue.com/blackvue-cloud-privacy-default/); [BlackVue AU privacy settings](https://www.blackvue.com.au/news/blackvue-cloud-privacy-settings/); [CSO Online (earlier 2018 exposure)](https://www.csoonline.com/article/3309952/security/blackvue-dashcams-share-cars-mapped-gps-locations-stream-video-feeds-and-audio.html)
- After an accident, deleting footage can let a jury presume it showed fault. — [Gary Martin Hays](https://www.garymartinhays.com/articles/spoliation-of-evidence-after-a-georgia-car-accident/); [Trial Magazine](https://justice.org/resources/publications/trial-magazine/2019-january/spoliation-in-the-digital-age)

### Inferences
- **A driving-*score* app makes this sharper than a plain dash cam.** AI labels such as "harsh brake 2s before impact" or "following too close" are *derived evidence*. They can be subpoenaed alongside the clip and read as admissions. A LAWYER should decide whether to retain AI-generated per-event judgments server-side, and for how long.
- **Product commitments to consider:**
  - Never share with insurers without per-incident user consent.
  - Publish a law-enforcement request policy: require legal process, notify the user unless gagged.
  - Keep clips on-device by default, with short cloud retention.
  - Never sell or license footage.
  - Keep public sharing off by default.
  These match or beat Nexar's posture and answer the BlackVue-style criticism.
- **The terms should warn users that footage may be evidence for or against them**, and that they are responsible for preserving it after an incident. Deletion tools should not be marketed as a way to avoid liability.
- **If the app ever partners with an insurer (UBI), new regimes apply:** state insurance regulation, and possibly FCRA if scores are used for underwriting. LAWYER.

### Gaps
- The full BlackVue law-enforcement disclosure text and its retention periods were not retrieved.
- No case law was found specifically on app-held (third-party cloud) dash cam clips being subpoenaed in civil auto cases.
- No source was found on whether insurers can contractually demand footage under policy cooperation clauses. LAWYER.
- Nexar's and BlackVue's Terms of Service, as distinct from their privacy policies, were not reviewed for indemnity or user-responsibility clauses.
