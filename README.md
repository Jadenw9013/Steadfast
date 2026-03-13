# Steadfast

Steadfast is a focused online coaching platform designed to streamline weekly client check-ins, meal plan management, and coach workflows.

Built for simplicity, speed, and clarity — so coaches can review faster and clients can act without confusion.

---

## 🚀 What It Does

### For Coaches
- View weekly client check-ins with Custom Check-In Templates
- See who needs review instantly
- Import meal plans and workout programs from image or PDF
- Automatically extract foods, portions, and exercises using OCR + AI
- Edit and publish structured meal plans and training programs
- Track client progress week-to-week
- Manage Coach Marketplace Profile, Portfolio, Testimonials, and Coaching Requests
- Streamline client onboarding with Custom Intake Forms

### For Clients
- Submit weekly check-ins
- Upload progress photos securely
- View current meal plan and training program
- See coach feedback
- Track weight and compliance
- Track daily adherence (Meals and Workouts check-offs)
- Log exercise progress (Reps/Weight tracking)

---

## 🧠 Core Philosophy

Steadfast is built around one principle:

> Every page should answer “What do I do next?” in under 5 seconds.

No clutter.  
No confusion.  
No admin-style dashboards.  

Just clarity and action.

---

## 🏗 Architecture Overview

### Frontend
- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Clerk (Authentication)

### Backend
- Next.js API Routes
- Prisma ORM
- PostgreSQL (Neon/Supabase)
- Supabase Storage (private buckets)
- Background Jobs (Vercel Cron)
- External Integrations (Twilio for SMS, Resend for Email)

### AI / Processing Pipeline

Meal Plan & Workout Program Import Flow:

1. File uploaded to private Supabase bucket
2. Server generates signed upload URL
3. Google Cloud Vision OCR extracts text
4. OpenAI structures meal plan or training program into JSON
5. Schema validation + normalization
6. Draft meal plan or workout program created
7. Coach reviews and publishes

All secrets remain server-side.

---

## 🔐 Security & Privacy

- Private Supabase storage buckets
- Signed upload URLs only
- No secrets in client code
- Role-based route protection
- Environment variables managed in Vercel
- Google Vision budget + quota capped
- LLM output validated before persistence

This is beta software. No medical claims are made.

---

## 📦 Installation (Development)

Clone the repo:

```bash
git clone https://github.com/YOUR_USERNAME/coach-platform.git
cd coach-platform
```

Install dependencies:

```bash
npm install
```

Create a `.env.local` file with:

```
DATABASE_URL=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_CLOUD_VISION_API_KEY=
OPENAI_API_KEY=
```

Run development server:

```bash
npm run dev
```

---

## 🧪 Production Verification

Before deploying, always run:

```bash
npm run build
npm run lint
./release.sh
```

See `prod-verification.md` for the full release checklist.

This prevents:
- Dev keys in prod
- Localhost references
- Missing routes
- OCR billing issues
- LLM schema crashes

---

## 🧾 Key Workflows To Test

Coach:
- Upload image meal plan → Draft created
- Upload PDF meal plan → Draft created
- Import without check-in → Works
- Review + publish plan

Client:
- Submit check-in
- Upload progress photos
- View published plan
- View feedback

---

## 🧭 Project Structure (High Level)

```
app/
  actions/
  api/
  coach/
  client/
  coaches/
components/
lib/
prisma/
public/
```

Core areas:
- `app/actions/` → Next.js Server Actions (adherence, marketplace, training)
- `lib/ocr/` → Vision integration
- `lib/llm/` → AI structuring
- `lib/supabase/` → storage handling
- `app/api/mealplans/` & `app/api/workout-import/` → import + draft logic

---

## 🎯 Current Status

- Fully functional coach + client workflow
- OCR meal plan import working (images + PDFs)
- Production deployment stable
- Release discipline enforced

Next phase:
- Real-world beta testing with coaches
- UX refinement
- Retention validation

---

## ⚠️ Beta Notice

Steadfast is currently in beta.

Features and workflows may evolve based on coach feedback.

---

## 📬 Contact

For access or collaboration inquiries:  
wong.jaden@icloud.com

---

Built with intention.  
Focused on clarity.  
Designed for disciplined coaching.
