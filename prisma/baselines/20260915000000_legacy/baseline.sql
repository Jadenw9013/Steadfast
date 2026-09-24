-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('COACH', 'CLIENT');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CheckInStatus" AS ENUM ('SUBMITTED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('MEAL_PLAN_UPDATE', 'CHECKIN_REMINDER');

-- CreateEnum
CREATE TYPE "ReminderStage" AS ENUM ('PRE_DUE', 'OVERDUE');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "CoachingMode" AS ENUM ('NONE', 'HUMAN', 'AI');

-- CreateEnum
CREATE TYPE "AiSafetyDisposition" AS ENUM ('CLEAR', 'CLARIFY', 'RESTRICTED', 'REFER', 'URGENT');

-- CreateEnum
CREATE TYPE "AiDomainPermission" AS ENUM ('ALLOW', 'HOLD_ONLY', 'PAUSED');

-- CreateEnum
CREATE TYPE "AiRunKind" AS ENUM ('INITIAL', 'WEEKLY_REVIEW', 'REPRESENTATION');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'RETRY_WAIT', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "AiChangeClass" AS ENUM ('INITIAL', 'ROUTINE', 'TARGET_PRESERVING', 'PROTECTIVE');

-- CreateEnum
CREATE TYPE "AiPlanStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DECLINED', 'SUPERSEDED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "AiReviewerStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AiLoadKind" AS ENUM ('EXTERNAL', 'BODYWEIGHT', 'ASSISTED');

-- CreateEnum
CREATE TYPE "AiReviewAction" AS ENUM ('HOLD', 'SIMPLIFY', 'ADJUST', 'CLARIFY', 'PAUSE_REFER');

-- CreateEnum
CREATE TYPE "MealPlanStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PlanMode" AS ENUM ('MEAL_PLAN', 'MACROS');

-- CreateEnum
CREATE TYPE "MealPlanUploadStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'NEEDS_REVIEW', 'IMPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "WorkoutImportStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'NEEDS_REVIEW', 'IMPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "TrainingProgramStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BlockType" AS ENUM ('EXERCISE', 'ACTIVATION', 'INSTRUCTION', 'SUPERSET', 'CARDIO', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'CONTACTED', 'CALL_SCHEDULED', 'ACCEPTED', 'DECLINED', 'APPROVED', 'REJECTED', 'WAITLISTED');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ConsultationStage" AS ENUM ('PENDING', 'CONSULTATION_SCHEDULED', 'CONSULTATION_DONE', 'INTAKE_SENT', 'INTAKE_SUBMITTED', 'FORMS_SENT', 'FORMS_SIGNED', 'ACTIVE', 'DECLINED');

-- CreateEnum
CREATE TYPE "CoachDocumentType" AS ENUM ('TEXT', 'FILE');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('MARKETPLACE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "FormSubmissionStatus" AS ENUM ('DRAFT', 'READY_TO_SEND', 'SENT', 'SIGNED');

-- CreateEnum
CREATE TYPE "SignatureType" AS ENUM ('TYPED', 'DRAWN');

-- CreateEnum
CREATE TYPE "AccountDeletionStatus" AS ENUM ('PENDING', 'CANCELLED', 'PURGING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'UNPAID', 'PAUSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "profilePhotoPath" TEXT,
    "clientBio" TEXT,
    "fitnessGoal" TEXT,
    "role" "Role" NOT NULL DEFAULT 'CLIENT',
    "isCoach" BOOLEAN NOT NULL DEFAULT false,
    "isClient" BOOLEAN NOT NULL DEFAULT true,
    "phoneNumber" TEXT,
    "apnsToken" TEXT,
    "smsOptIn" BOOLEAN NOT NULL DEFAULT false,
    "smsMealPlanUpdates" BOOLEAN NOT NULL DEFAULT false,
    "smsDailyCheckInReminder" BOOLEAN NOT NULL DEFAULT false,
    "smsCoachMessages" BOOLEAN NOT NULL DEFAULT false,
    "smsCheckInFeedback" BOOLEAN NOT NULL DEFAULT false,
    "smsCheckInReminderTime" TEXT NOT NULL DEFAULT '19:00',
    "smsClientCheckIns" BOOLEAN NOT NULL DEFAULT false,
    "smsMissedCheckInAlerts" BOOLEAN NOT NULL DEFAULT false,
    "smsClientMessages" BOOLEAN NOT NULL DEFAULT false,
    "smsNewClientSignups" BOOLEAN NOT NULL DEFAULT false,
    "smsMissedCheckInAlertTime" TEXT NOT NULL DEFAULT '21:00',
    "emailCheckInReminders" BOOLEAN NOT NULL DEFAULT true,
    "emailMealPlanUpdates" BOOLEAN NOT NULL DEFAULT true,
    "emailCoachMessages" BOOLEAN NOT NULL DEFAULT true,
    "emailClientCheckIns" BOOLEAN NOT NULL DEFAULT true,
    "emailClientMessages" BOOLEAN NOT NULL DEFAULT true,
    "emailCoachingRequests" BOOLEAN NOT NULL DEFAULT true,
    "pushMealPlanUpdates" BOOLEAN NOT NULL DEFAULT true,
    "pushCheckInReminders" BOOLEAN NOT NULL DEFAULT true,
    "pushCoachMessages" BOOLEAN NOT NULL DEFAULT true,
    "pushClientCheckIns" BOOLEAN NOT NULL DEFAULT true,
    "pushClientMessages" BOOLEAN NOT NULL DEFAULT true,
    "pushCoachingRequests" BOOLEAN NOT NULL DEFAULT true,
    "defaultNotifyOnPublish" BOOLEAN NOT NULL DEFAULT true,
    "checkInDaysOfWeek" INTEGER[] DEFAULT ARRAY[1]::INTEGER[],
    "cadenceConfig" JSONB,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "team_id" TEXT,
    "team_role" TEXT,
    "isDeactivated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientCoachingContext" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "mode" "CoachingMode" NOT NULL DEFAULT 'NONE',
    "activeCoachClientId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "resolutionRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCoachingContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCoachProfile" (
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "profileRevision" INTEGER NOT NULL DEFAULT 0,
    "observationRevision" INTEGER NOT NULL DEFAULT 0,
    "safetyRevision" INTEGER NOT NULL DEFAULT 0,
    "reviewTimezone" TEXT,
    "activePlanVersionId" TEXT,
    "consentedAt" TIMESTAMP(3),
    "confirmedIntake" JSONB,
    "safetyDisposition" "AiSafetyDisposition" NOT NULL DEFAULT 'CLEAR',
    "nutritionPermission" "AiDomainPermission" NOT NULL DEFAULT 'ALLOW',
    "strengthPermission" "AiDomainPermission" NOT NULL DEFAULT 'ALLOW',
    "cardioPermission" "AiDomainPermission" NOT NULL DEFAULT 'ALLOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCoachProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiIntakeDraft" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiIntakeDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSafetyDisclosureEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "structuredAnswers" JSONB NOT NULL,
    "dispositionAfter" "AiSafetyDisposition" NOT NULL,
    "nutritionPermissionAfter" "AiDomainPermission" NOT NULL,
    "strengthPermissionAfter" "AiDomainPermission" NOT NULL,
    "cardioPermissionAfter" "AiDomainPermission" NOT NULL,
    "safetyRevisionAfter" INTEGER NOT NULL,

    CONSTRAINT "AiSafetyDisclosureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCoachEntitlement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AiCoachEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCoachRun" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "AiRunKind" NOT NULL,
    "status" "AiRunStatus" NOT NULL DEFAULT 'QUEUED',
    "businessKey" TEXT NOT NULL,
    "contextRevision" INTEGER NOT NULL,
    "profileRevision" INTEGER NOT NULL,
    "observationRevision" INTEGER NOT NULL,
    "safetyRevision" INTEGER NOT NULL,
    "lookbackStart" TIMESTAMP(3),
    "lookbackEnd" TIMESTAMP(3),
    "snapshotCutoffAt" TIMESTAMP(3),
    "activationStartsAt" TIMESTAMP(3),
    "activationEndsAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "fencingToken" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retryGeneration" INTEGER NOT NULL DEFAULT 0,
    "retryOfRunId" TEXT,
    "lastError" TEXT,
    "checkpointData" JSONB,
    "inputSnapshot" JSONB,
    "resultDecision" JSONB,
    "resultPlanVersionId" TEXT,
    "resultReviewAction" "AiReviewAction",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCoachRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPlanVersion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "baseVersionId" TEXT,
    "status" "AiPlanStatus" NOT NULL DEFAULT 'PROPOSED',
    "changeClass" "AiChangeClass",
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "contextRevision" INTEGER NOT NULL,
    "profileRevision" INTEGER NOT NULL,
    "observationRevision" INTEGER NOT NULL,
    "safetyRevision" INTEGER NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "catalogVersions" JSONB NOT NULL,
    "activationStartsAt" TIMESTAMP(3),
    "activationEndsAt" TIMESTAMP(3),
    "reviewerStatus" "AiReviewerStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "reviewerApprovalHash" TEXT,
    "reviewWindowKey" TEXT,
    "validationReport" JSONB,
    "sourceRefs" JSONB,
    "acceptedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPlanAcceptanceReceipt" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "alreadyAccepted" BOOLEAN NOT NULL,
    "activeVersionIdAtReceiptTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPlanAcceptanceReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPlanAcceptanceOutbox" (
    "id" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "AiPlanAcceptanceOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAdjustmentSlot" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reviewWindowKey" TEXT NOT NULL,
    "acceptedPlanVersionId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAdjustmentSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCoachReviewerGrant" (
    "clientIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "qualificationNote" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AiCoachReviewerGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPlanReviewerApproval" (
    "id" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "reviewerGrantId" TEXT NOT NULL,
    "stateHash" TEXT,
    "approvedHash" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "rationale" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPlanReviewerApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiWorkoutSession" (
    "modality" TEXT NOT NULL DEFAULT 'STRENGTH',
    "sessionInstanceId" TEXT,
    "prescriptionSessionId" TEXT,
    "durationMinutes" DOUBLE PRECISION,
    "resultStatus" TEXT NOT NULL DEFAULT 'REPORTED_PARTIAL',
    "painReported" BOOLEAN NOT NULL DEFAULT false,
    "effortRating" INTEGER,
    "inputDigest" TEXT,
    "deletedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "setIndex" INTEGER NOT NULL,
    "reps" INTEGER,
    "loadValue" DOUBLE PRECISION,
    "loadUnit" TEXT,
    "loadKind" "AiLoadKind",
    "painNote" TEXT,
    "effortNote" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiWorkoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCheckInObservation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "submitted" BOOLEAN NOT NULL DEFAULT false,
    "inputDigest" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCheckInObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiOperationReceipt" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiOperationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeFormTemplate" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeFormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachClient" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "coachNotes" TEXT,
    "checkInDaysOfWeekOverride" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "cadenceConfig" JSONB,
    "adherenceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "planMode" "PlanMode" NOT NULL DEFAULT 'MEAL_PLAN',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoPath" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "inviteToken" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInTemplate" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "questions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckInTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "weight" DOUBLE PRECISION,
    "bodyFatPct" DOUBLE PRECISION,
    "status" "CheckInStatus" NOT NULL DEFAULT 'SUBMITTED',
    "dietCompliance" INTEGER,
    "energyLevel" INTEGER,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "localDate" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "periodStartDate" TEXT NOT NULL DEFAULT '',
    "periodEndDate" TEXT NOT NULL DEFAULT '',
    "templateId" TEXT,
    "templateSnapshot" JSONB,
    "customResponses" JSONB,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroTarget" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "calories" INTEGER NOT NULL,
    "protein" INTEGER NOT NULL,
    "carbs" INTEGER NOT NULL,
    "fats" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlan" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "MealPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "planMode" "PlanMode" NOT NULL DEFAULT 'MEAL_PLAN',
    "supportContent" TEXT,
    "planExtras" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlanItem" (
    "id" TEXT NOT NULL,
    "mealPlanId" TEXT NOT NULL,
    "mealName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "foodName" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "servingDescription" TEXT,
    "calories" INTEGER NOT NULL DEFAULT 0,
    "protein" INTEGER NOT NULL DEFAULT 0,
    "carbs" INTEGER NOT NULL DEFAULT 0,
    "fats" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MealPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealMacroTarget" (
    "id" TEXT NOT NULL,
    "mealPlanId" TEXT NOT NULL,
    "mealName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "calories" INTEGER NOT NULL DEFAULT 0,
    "protein" INTEGER NOT NULL DEFAULT 0,
    "carbs" INTEGER NOT NULL DEFAULT 0,
    "fats" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MealMacroTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coachId" TEXT,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedId" TEXT NOT NULL,
    "messageId" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInPhoto" (
    "id" TEXT NOT NULL,
    "checkInId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckInPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodLibraryItem" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultUnit" TEXT NOT NULL DEFAULT 'serving',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FoodLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlanUpload" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL DEFAULT 'meal-plan-uploads',
    "storagePath" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "status" "MealPlanUploadStatus" NOT NULL DEFAULT 'UPLOADED',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealPlanUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlanDraft" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "extractedText" TEXT,
    "supportContent" TEXT,
    "parsedJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealPlanDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutImport" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "clientId" TEXT,
    "storageBucket" TEXT NOT NULL DEFAULT 'meal-plan-uploads',
    "storagePath" TEXT NOT NULL DEFAULT '',
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "status" "WorkoutImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutImportDraft" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "extractedText" TEXT,
    "parsedJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutImportDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingTemplate" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingTemplateDay" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "dayName" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrainingTemplateDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingTemplateBlock" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "type" "BlockType" NOT NULL DEFAULT 'EXERCISE',
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrainingTemplateBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingTemplateExercise" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sets" INTEGER NOT NULL DEFAULT 3,
    "reps" TEXT NOT NULL DEFAULT '10',
    "intensityText" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrainingTemplateExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingTemplateCardio" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "frequency" TEXT,
    "duration" TEXT,
    "modality" TEXT,
    "intensity" TEXT,
    "notes" TEXT,

    CONSTRAINT "TrainingTemplateCardio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingProgram" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "status" "TrainingProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "templateSourceId" TEXT,
    "weeklyFrequency" INTEGER,
    "clientNotes" TEXT,
    "injuries" TEXT,
    "equipment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingProgramCardio" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "frequency" TEXT,
    "duration" TEXT,
    "modality" TEXT,
    "intensity" TEXT,
    "notes" TEXT,

    CONSTRAINT "TrainingProgramCardio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingDay" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "dayName" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrainingDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingProgramBlock" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "type" "BlockType" NOT NULL DEFAULT 'EXERCISE',
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrainingProgramBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingExercise" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sets" INTEGER NOT NULL DEFAULT 3,
    "reps" TEXT NOT NULL DEFAULT '10',
    "intensityText" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrainingExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "clientId" TEXT NOT NULL,
    "mealPlanId" TEXT,
    "windowStartDate" TIMESTAMP(3),
    "stage" "ReminderStage",
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "headline" TEXT,
    "bio" TEXT,
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pricing" TEXT,
    "acceptingClients" BOOLEAN NOT NULL DEFAULT true,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "welcomeMessage" TEXT,
    "bannerPhotoPath" TEXT,
    "experience" TEXT,
    "certifications" TEXT,
    "coachingType" TEXT,
    "location" TEXT,
    "city" TEXT,
    "state" TEXT,
    "serviceTier" TEXT,
    "gymName" TEXT,
    "yearsCoaching" INTEGER,
    "phoneNumber" TEXT,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clientGoals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clientTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioItem" (
    "id" TEXT NOT NULL,
    "coachProfileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "result" TEXT,
    "description" TEXT,
    "category" TEXT,
    "mediaPath" TEXT,
    "mediaType" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Testimonial" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "reviewText" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'published',
    "reportReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Testimonial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedCoach" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "coachProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedCoach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachingRequest" (
    "id" TEXT NOT NULL,
    "coachProfileId" TEXT NOT NULL,
    "prospectName" TEXT NOT NULL,
    "prospectEmail" TEXT NOT NULL,
    "prospectPhone" TEXT,
    "prospectEmailAddr" TEXT,
    "intakeAnswers" JSONB NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "consultationStage" "ConsultationStage" NOT NULL DEFAULT 'PENDING',
    "consultationDate" TIMESTAMP(3),
    "source" "LeadSource" NOT NULL DEFAULT 'MARKETPLACE',
    "sourceDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "prospectId" TEXT,
    "inviteLastSentAt" TIMESTAMP(3),
    "inviteSendCount" INTEGER NOT NULL DEFAULT 0,
    "coachNotes" TEXT,
    "formsToken" TEXT,
    "formsTokenExpiresAt" TIMESTAMP(3),
    "formsSentAt" TIMESTAMP(3),
    "formsSignedAt" TIMESTAMP(3),

    CONSTRAINT "CoachingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFormSubmission" (
    "id" TEXT NOT NULL,
    "coachingRequestId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "status" "FormSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientFormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFormSignature" (
    "id" TEXT NOT NULL,
    "coachingRequestId" TEXT NOT NULL,
    "signatureType" "SignatureType" NOT NULL,
    "signatureValue" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientFormSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientInvite" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inviteToken" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "requestId" TEXT,

    CONSTRAINT "ClientInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationMeeting" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "meetingLink" TEXT,
    "scheduledTime" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachSettings" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "acceptRequestsAutomatically" BOOLEAN NOT NULL DEFAULT false,
    "requireConsultation" BOOLEAN NOT NULL DEFAULT false,
    "allowDirectInvites" BOOLEAN NOT NULL DEFAULT true,
    "allowMarketplaceRequests" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CoachSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingForm" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingResponse" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientIntake" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "IntakeStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "bodyweightLbs" DOUBLE PRECISION,
    "heightInches" DOUBLE PRECISION,
    "ageYears" INTEGER,
    "gender" TEXT,
    "primaryGoal" TEXT,
    "targetTimeline" TEXT,
    "injuries" TEXT,
    "dietaryRestrictions" TEXT,
    "dietaryPreferences" TEXT,
    "currentDiet" TEXT,
    "trainingExperience" TEXT,
    "trainingDaysPerWeek" INTEGER,
    "gymAccess" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanSnippet" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanSnippet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyAdherence" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "workoutCompleted" BOOLEAN NOT NULL DEFAULT false,
    "workoutCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAdherence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMealCheckoff" (
    "id" TEXT NOT NULL,
    "dailyAdherenceId" TEXT NOT NULL,
    "mealNameSnapshot" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyMealCheckoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseCheckoff" (
    "id" TEXT NOT NULL,
    "dailyAdherenceId" TEXT NOT NULL,
    "dayLabel" TEXT NOT NULL,
    "exerciseName" TEXT NOT NULL,
    "exerciseOrder" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseCheckoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseResult" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "exerciseName" TEXT NOT NULL,
    "programDay" TEXT NOT NULL,
    "setNumber" INTEGER NOT NULL DEFAULT 1,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "sessionDate" TEXT NOT NULL DEFAULT '',
    "weight" DOUBLE PRECISION NOT NULL,
    "reps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachDocument" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "CoachDocumentType" NOT NULL,
    "content" TEXT,
    "filePath" TEXT,
    "fileType" TEXT,
    "fileName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakePacket" (
    "id" TEXT NOT NULL,
    "coachingRequestId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "formAnswers" JSONB,
    "coachNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakePacket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakePacketDocument" (
    "id" TEXT NOT NULL,
    "intakePacketId" TEXT NOT NULL,
    "coachDocumentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "uploadedSignedFilePath" TEXT,
    "uploadedSignedFileName" TEXT,
    "uploadedSignedAt" TIMESTAMP(3),

    CONSTRAINT "IntakePacketDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSignature" (
    "id" TEXT NOT NULL,
    "intakePacketDocumentId" TEXT NOT NULL,
    "coachDocumentId" TEXT NOT NULL,
    "signatureType" "SignatureType" NOT NULL,
    "signatureValue" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "DocumentSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledPurgeAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "purgeStartedAt" TIMESTAMP(3),
    "purgeCompletedAt" TIMESTAMP(3),
    "deletionReason" TEXT,
    "roleAtRequest" TEXT NOT NULL,
    "clerkId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "stripeSubscriptionCancelledAt" TIMESTAMP(3),
    "storageCleanedAt" TIMESTAMP(3),
    "clerkDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachSubscription" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "checkoutSessionId" TEXT,
    "stripePriceId" TEXT,
    "status" "SubscriptionStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "trialEnd" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestQuota" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestQuota_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "StorageCleanupOutbox" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "StorageCleanupOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkId_key" ON "User"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ClientCoachingContext_clientId_key" ON "ClientCoachingContext"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientCoachingContext_activeCoachClientId_key" ON "ClientCoachingContext"("activeCoachClientId");

-- CreateIndex
CREATE UNIQUE INDEX "AiCoachProfile_clientId_key" ON "AiCoachProfile"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "AiIntakeDraft_clientId_key" ON "AiIntakeDraft"("clientId");

-- CreateIndex
CREATE INDEX "AiSafetyDisclosureEvent_clientId_reportedAt_idx" ON "AiSafetyDisclosureEvent"("clientId", "reportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiCoachEntitlement_clientId_key" ON "AiCoachEntitlement"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "AiCoachRun_businessKey_key" ON "AiCoachRun"("businessKey");

-- CreateIndex
CREATE INDEX "AiCoachRun_clientId_idx" ON "AiCoachRun"("clientId");

-- CreateIndex
CREATE INDEX "AiCoachRun_status_leaseExpiresAt_idx" ON "AiCoachRun"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AiPlanVersion_clientId_status_idx" ON "AiPlanVersion"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiPlanVersion_clientId_version_key" ON "AiPlanVersion"("clientId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AiPlanAcceptanceReceipt_clientId_requestKey_key" ON "AiPlanAcceptanceReceipt"("clientId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiPlanAcceptanceOutbox_planVersionId_key" ON "AiPlanAcceptanceOutbox"("planVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "AiAdjustmentSlot_acceptedPlanVersionId_key" ON "AiAdjustmentSlot"("acceptedPlanVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "AiAdjustmentSlot_clientId_reviewWindowKey_key" ON "AiAdjustmentSlot"("clientId", "reviewWindowKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiCoachReviewerGrant_userId_key" ON "AiCoachReviewerGrant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AiPlanReviewerApproval_planVersionId_key" ON "AiPlanReviewerApproval"("planVersionId");

-- CreateIndex
CREATE INDEX "AiWorkoutSession_clientId_occurredAt_idx" ON "AiWorkoutSession"("clientId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiWorkoutSession_clientId_clientEventId_key" ON "AiWorkoutSession"("clientId", "clientEventId");

-- CreateIndex
CREATE INDEX "AiCheckInObservation_clientId_occurredAt_idx" ON "AiCheckInObservation"("clientId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiCheckInObservation_clientId_clientEventId_key" ON "AiCheckInObservation"("clientId", "clientEventId");

-- CreateIndex
CREATE UNIQUE INDEX "AiOperationReceipt_clientId_operation_requestKey_key" ON "AiOperationReceipt"("clientId", "operation", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeFormTemplate_coachId_key" ON "IntakeFormTemplate"("coachId");

-- CreateIndex
CREATE INDEX "CoachClient_coachId_idx" ON "CoachClient"("coachId");

-- CreateIndex
CREATE INDEX "CoachClient_clientId_idx" ON "CoachClient"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "CoachClient_coachId_clientId_key" ON "CoachClient"("coachId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_inviteToken_key" ON "TeamInvite"("inviteToken");

-- CreateIndex
CREATE INDEX "TeamInvite_teamId_idx" ON "TeamInvite"("teamId");

-- CreateIndex
CREATE INDEX "TeamInvite_inviteToken_idx" ON "TeamInvite"("inviteToken");

-- CreateIndex
CREATE INDEX "CheckInTemplate_coachId_idx" ON "CheckInTemplate"("coachId");

-- CreateIndex
CREATE INDEX "CheckIn_clientId_weekOf_idx" ON "CheckIn"("clientId", "weekOf");

-- CreateIndex
CREATE INDEX "CheckIn_clientId_submittedAt_idx" ON "CheckIn"("clientId", "submittedAt");

-- CreateIndex
CREATE INDEX "CheckIn_clientId_localDate_idx" ON "CheckIn"("clientId", "localDate");

-- CreateIndex
CREATE INDEX "CheckIn_clientId_periodStartDate_idx" ON "CheckIn"("clientId", "periodStartDate");

-- CreateIndex
CREATE UNIQUE INDEX "MacroTarget_clientId_weekOf_key" ON "MacroTarget"("clientId", "weekOf");

-- CreateIndex
CREATE INDEX "MealPlan_clientId_weekOf_idx" ON "MealPlan"("clientId", "weekOf");

-- CreateIndex
CREATE INDEX "MealPlan_clientId_status_idx" ON "MealPlan"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MealPlan_clientId_weekOf_version_key" ON "MealPlan"("clientId", "weekOf", "version");

-- CreateIndex
CREATE INDEX "MealPlanItem_mealPlanId_idx" ON "MealPlanItem"("mealPlanId");

-- CreateIndex
CREATE INDEX "MealMacroTarget_mealPlanId_idx" ON "MealMacroTarget"("mealPlanId");

-- CreateIndex
CREATE INDEX "Message_clientId_weekOf_idx" ON "Message"("clientId", "weekOf");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "Message_clientId_coachId_idx" ON "Message"("clientId", "coachId");

-- CreateIndex
CREATE INDEX "UserBlock_blockerId_idx" ON "UserBlock"("blockerId");

-- CreateIndex
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBlock_blockerId_blockedId_key" ON "UserBlock"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "MessageReport_reporterId_idx" ON "MessageReport"("reporterId");

-- CreateIndex
CREATE INDEX "MessageReport_reportedId_idx" ON "MessageReport"("reportedId");

-- CreateIndex
CREATE INDEX "CheckInPhoto_checkInId_idx" ON "CheckInPhoto"("checkInId");

-- CreateIndex
CREATE INDEX "FoodLibraryItem_coachId_idx" ON "FoodLibraryItem"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "FoodLibraryItem_coachId_name_key" ON "FoodLibraryItem"("coachId", "name");

-- CreateIndex
CREATE INDEX "MealPlanUpload_coachId_idx" ON "MealPlanUpload"("coachId");

-- CreateIndex
CREATE INDEX "MealPlanUpload_clientId_idx" ON "MealPlanUpload"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "MealPlanDraft_uploadId_key" ON "MealPlanDraft"("uploadId");

-- CreateIndex
CREATE INDEX "WorkoutImport_coachId_idx" ON "WorkoutImport"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutImportDraft_importId_key" ON "WorkoutImportDraft"("importId");

-- CreateIndex
CREATE INDEX "TrainingTemplate_coachId_idx" ON "TrainingTemplate"("coachId");

-- CreateIndex
CREATE INDEX "TrainingTemplateDay_templateId_idx" ON "TrainingTemplateDay"("templateId");

-- CreateIndex
CREATE INDEX "TrainingTemplateBlock_dayId_idx" ON "TrainingTemplateBlock"("dayId");

-- CreateIndex
CREATE INDEX "TrainingTemplateExercise_dayId_idx" ON "TrainingTemplateExercise"("dayId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingTemplateCardio_templateId_key" ON "TrainingTemplateCardio"("templateId");

-- CreateIndex
CREATE INDEX "TrainingProgram_clientId_weekOf_idx" ON "TrainingProgram"("clientId", "weekOf");

-- CreateIndex
CREATE INDEX "TrainingProgram_clientId_status_idx" ON "TrainingProgram"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProgramCardio_programId_key" ON "TrainingProgramCardio"("programId");

-- CreateIndex
CREATE INDEX "TrainingDay_programId_idx" ON "TrainingDay"("programId");

-- CreateIndex
CREATE INDEX "TrainingProgramBlock_dayId_idx" ON "TrainingProgramBlock"("dayId");

-- CreateIndex
CREATE INDEX "TrainingExercise_dayId_idx" ON "TrainingExercise"("dayId");

-- CreateIndex
CREATE INDEX "NotificationLog_clientId_type_idx" ON "NotificationLog"("clientId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_clientId_windowStartDate_type_stage_key" ON "NotificationLog"("clientId", "windowStartDate", "type", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "CoachProfile_userId_key" ON "CoachProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CoachProfile_slug_key" ON "CoachProfile"("slug");

-- CreateIndex
CREATE INDEX "PortfolioItem_coachProfileId_idx" ON "PortfolioItem"("coachProfileId");

-- CreateIndex
CREATE INDEX "Testimonial_coachId_idx" ON "Testimonial"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "Testimonial_coachId_clientId_key" ON "Testimonial"("coachId", "clientId");

-- CreateIndex
CREATE INDEX "SavedCoach_userId_idx" ON "SavedCoach"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedCoach_userId_coachProfileId_key" ON "SavedCoach"("userId", "coachProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "CoachingRequest_formsToken_key" ON "CoachingRequest"("formsToken");

-- CreateIndex
CREATE INDEX "CoachingRequest_coachProfileId_idx" ON "CoachingRequest"("coachProfileId");

-- CreateIndex
CREATE INDEX "CoachingRequest_status_idx" ON "CoachingRequest"("status");

-- CreateIndex
CREATE INDEX "CoachingRequest_consultationStage_idx" ON "CoachingRequest"("consultationStage");

-- CreateIndex
CREATE INDEX "CoachingRequest_prospectId_idx" ON "CoachingRequest"("prospectId");

-- CreateIndex
CREATE INDEX "CoachingRequest_prospectEmail_status_idx" ON "CoachingRequest"("prospectEmail", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientFormSubmission_coachingRequestId_key" ON "ClientFormSubmission"("coachingRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientFormSignature_coachingRequestId_key" ON "ClientFormSignature"("coachingRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientInvite_inviteToken_key" ON "ClientInvite"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "ClientInvite_requestId_key" ON "ClientInvite"("requestId");

-- CreateIndex
CREATE INDEX "ClientInvite_coachId_idx" ON "ClientInvite"("coachId");

-- CreateIndex
CREATE INDEX "ClientInvite_inviteToken_idx" ON "ClientInvite"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationMeeting_requestId_key" ON "ConsultationMeeting"("requestId");

-- CreateIndex
CREATE INDEX "ConsultationMeeting_coachId_idx" ON "ConsultationMeeting"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "CoachSettings_coachId_key" ON "CoachSettings"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingForm_coachId_key" ON "OnboardingForm"("coachId");

-- CreateIndex
CREATE INDEX "OnboardingForm_coachId_idx" ON "OnboardingForm"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingResponse_clientId_key" ON "OnboardingResponse"("clientId");

-- CreateIndex
CREATE INDEX "OnboardingResponse_coachId_idx" ON "OnboardingResponse"("coachId");

-- CreateIndex
CREATE INDEX "OnboardingResponse_formId_idx" ON "OnboardingResponse"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientIntake_clientId_key" ON "ClientIntake"("clientId");

-- CreateIndex
CREATE INDEX "ClientIntake_coachId_idx" ON "ClientIntake"("coachId");

-- CreateIndex
CREATE INDEX "ClientIntake_clientId_idx" ON "ClientIntake"("clientId");

-- CreateIndex
CREATE INDEX "PlanSnippet_coachId_type_idx" ON "PlanSnippet"("coachId", "type");

-- CreateIndex
CREATE INDEX "DailyAdherence_clientId_idx" ON "DailyAdherence"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAdherence_clientId_date_key" ON "DailyAdherence"("clientId", "date");

-- CreateIndex
CREATE INDEX "DailyMealCheckoff_dailyAdherenceId_idx" ON "DailyMealCheckoff"("dailyAdherenceId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMealCheckoff_dailyAdherenceId_mealNameSnapshot_key" ON "DailyMealCheckoff"("dailyAdherenceId", "mealNameSnapshot");

-- CreateIndex
CREATE INDEX "ExerciseCheckoff_dailyAdherenceId_idx" ON "ExerciseCheckoff"("dailyAdherenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseCheckoff_dailyAdherenceId_dayLabel_exerciseOrder_key" ON "ExerciseCheckoff"("dailyAdherenceId", "dayLabel", "exerciseOrder");

-- CreateIndex
CREATE INDEX "ExerciseResult_clientId_idx" ON "ExerciseResult"("clientId");

-- CreateIndex
CREATE INDEX "ExerciseResult_clientId_weekOf_idx" ON "ExerciseResult"("clientId", "weekOf");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseResult_clientId_exerciseName_programDay_setNumber_s_key" ON "ExerciseResult"("clientId", "exerciseName", "programDay", "setNumber", "sessionDate");

-- CreateIndex
CREATE INDEX "CoachDocument_coachId_idx" ON "CoachDocument"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakePacket_coachingRequestId_key" ON "IntakePacket"("coachingRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakePacket_token_key" ON "IntakePacket"("token");

-- CreateIndex
CREATE INDEX "IntakePacketDocument_intakePacketId_idx" ON "IntakePacketDocument"("intakePacketId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSignature_intakePacketDocumentId_key" ON "DocumentSignature"("intakePacketDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountDeletionRequest_userId_key" ON "AccountDeletionRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CoachSubscription_coachId_key" ON "CoachSubscription"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "CoachSubscription_stripeCustomerId_key" ON "CoachSubscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "CoachSubscription_stripeSubscriptionId_key" ON "CoachSubscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "RequestQuota_expiresAt_idx" ON "RequestQuota"("expiresAt");

-- CreateIndex
CREATE INDEX "StorageCleanupOutbox_processedAt_idx" ON "StorageCleanupOutbox"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StorageCleanupOutbox_bucket_storagePath_key" ON "StorageCleanupOutbox"("bucket", "storagePath");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCoachingContext" ADD CONSTRAINT "ClientCoachingContext_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCoachingContext" ADD CONSTRAINT "ClientCoachingContext_activeCoachClientId_fkey" FOREIGN KEY ("activeCoachClientId") REFERENCES "CoachClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCoachProfile" ADD CONSTRAINT "AiCoachProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiIntakeDraft" ADD CONSTRAINT "AiIntakeDraft_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSafetyDisclosureEvent" ADD CONSTRAINT "AiSafetyDisclosureEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCoachEntitlement" ADD CONSTRAINT "AiCoachEntitlement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCoachRun" ADD CONSTRAINT "AiCoachRun_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCoachRun" ADD CONSTRAINT "AiCoachRun_retryOfRunId_fkey" FOREIGN KEY ("retryOfRunId") REFERENCES "AiCoachRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanVersion" ADD CONSTRAINT "AiPlanVersion_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanVersion" ADD CONSTRAINT "AiPlanVersion_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "AiPlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanAcceptanceReceipt" ADD CONSTRAINT "AiPlanAcceptanceReceipt_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanAcceptanceOutbox" ADD CONSTRAINT "AiPlanAcceptanceOutbox_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanAcceptanceOutbox" ADD CONSTRAINT "AiPlanAcceptanceOutbox_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "AiPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAdjustmentSlot" ADD CONSTRAINT "AiAdjustmentSlot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAdjustmentSlot" ADD CONSTRAINT "AiAdjustmentSlot_acceptedPlanVersionId_fkey" FOREIGN KEY ("acceptedPlanVersionId") REFERENCES "AiPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCoachReviewerGrant" ADD CONSTRAINT "AiCoachReviewerGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanReviewerApproval" ADD CONSTRAINT "AiPlanReviewerApproval_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "AiPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanReviewerApproval" ADD CONSTRAINT "AiPlanReviewerApproval_reviewerGrantId_fkey" FOREIGN KEY ("reviewerGrantId") REFERENCES "AiCoachReviewerGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWorkoutSession" ADD CONSTRAINT "AiWorkoutSession_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWorkoutSession" ADD CONSTRAINT "AiWorkoutSession_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "AiPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCheckInObservation" ADD CONSTRAINT "AiCheckInObservation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOperationReceipt" ADD CONSTRAINT "AiOperationReceipt_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeFormTemplate" ADD CONSTRAINT "IntakeFormTemplate_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachClient" ADD CONSTRAINT "CoachClient_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachClient" ADD CONSTRAINT "CoachClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInTemplate" ADD CONSTRAINT "CheckInTemplate_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CheckInTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroTarget" ADD CONSTRAINT "MacroTarget_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlan" ADD CONSTRAINT "MealPlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanItem" ADD CONSTRAINT "MealPlanItem_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealMacroTarget" ADD CONSTRAINT "MealMacroTarget_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReport" ADD CONSTRAINT "MessageReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReport" ADD CONSTRAINT "MessageReport_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInPhoto" ADD CONSTRAINT "CheckInPhoto_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "CheckIn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodLibraryItem" ADD CONSTRAINT "FoodLibraryItem_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanUpload" ADD CONSTRAINT "MealPlanUpload_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanUpload" ADD CONSTRAINT "MealPlanUpload_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanDraft" ADD CONSTRAINT "MealPlanDraft_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "MealPlanUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutImport" ADD CONSTRAINT "WorkoutImport_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutImportDraft" ADD CONSTRAINT "WorkoutImportDraft_importId_fkey" FOREIGN KEY ("importId") REFERENCES "WorkoutImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingTemplate" ADD CONSTRAINT "TrainingTemplate_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingTemplateDay" ADD CONSTRAINT "TrainingTemplateDay_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TrainingTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingTemplateBlock" ADD CONSTRAINT "TrainingTemplateBlock_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "TrainingTemplateDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingTemplateExercise" ADD CONSTRAINT "TrainingTemplateExercise_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "TrainingTemplateDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingTemplateCardio" ADD CONSTRAINT "TrainingTemplateCardio_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TrainingTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgram" ADD CONSTRAINT "TrainingProgram_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgram" ADD CONSTRAINT "TrainingProgram_templateSourceId_fkey" FOREIGN KEY ("templateSourceId") REFERENCES "TrainingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgramCardio" ADD CONSTRAINT "TrainingProgramCardio_programId_fkey" FOREIGN KEY ("programId") REFERENCES "TrainingProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingDay" ADD CONSTRAINT "TrainingDay_programId_fkey" FOREIGN KEY ("programId") REFERENCES "TrainingProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgramBlock" ADD CONSTRAINT "TrainingProgramBlock_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "TrainingDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingExercise" ADD CONSTRAINT "TrainingExercise_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "TrainingDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioItem" ADD CONSTRAINT "PortfolioItem_coachProfileId_fkey" FOREIGN KEY ("coachProfileId") REFERENCES "CoachProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedCoach" ADD CONSTRAINT "SavedCoach_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedCoach" ADD CONSTRAINT "SavedCoach_coachProfileId_fkey" FOREIGN KEY ("coachProfileId") REFERENCES "CoachProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingRequest" ADD CONSTRAINT "CoachingRequest_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingRequest" ADD CONSTRAINT "CoachingRequest_coachProfileId_fkey" FOREIGN KEY ("coachProfileId") REFERENCES "CoachProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFormSubmission" ADD CONSTRAINT "ClientFormSubmission_coachingRequestId_fkey" FOREIGN KEY ("coachingRequestId") REFERENCES "CoachingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFormSignature" ADD CONSTRAINT "ClientFormSignature_coachingRequestId_fkey" FOREIGN KEY ("coachingRequestId") REFERENCES "CoachingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvite" ADD CONSTRAINT "ClientInvite_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CoachingRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvite" ADD CONSTRAINT "ClientInvite_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationMeeting" ADD CONSTRAINT "ConsultationMeeting_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationMeeting" ADD CONSTRAINT "ConsultationMeeting_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CoachingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachSettings" ADD CONSTRAINT "CoachSettings_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingForm" ADD CONSTRAINT "OnboardingForm_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingResponse" ADD CONSTRAINT "OnboardingResponse_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingResponse" ADD CONSTRAINT "OnboardingResponse_formId_fkey" FOREIGN KEY ("formId") REFERENCES "OnboardingForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientIntake" ADD CONSTRAINT "ClientIntake_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientIntake" ADD CONSTRAINT "ClientIntake_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSnippet" ADD CONSTRAINT "PlanSnippet_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAdherence" ADD CONSTRAINT "DailyAdherence_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMealCheckoff" ADD CONSTRAINT "DailyMealCheckoff_dailyAdherenceId_fkey" FOREIGN KEY ("dailyAdherenceId") REFERENCES "DailyAdherence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseCheckoff" ADD CONSTRAINT "ExerciseCheckoff_dailyAdherenceId_fkey" FOREIGN KEY ("dailyAdherenceId") REFERENCES "DailyAdherence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseResult" ADD CONSTRAINT "ExerciseResult_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachDocument" ADD CONSTRAINT "CoachDocument_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakePacket" ADD CONSTRAINT "IntakePacket_coachingRequestId_fkey" FOREIGN KEY ("coachingRequestId") REFERENCES "CoachingRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakePacketDocument" ADD CONSTRAINT "IntakePacketDocument_intakePacketId_fkey" FOREIGN KEY ("intakePacketId") REFERENCES "IntakePacket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakePacketDocument" ADD CONSTRAINT "IntakePacketDocument_coachDocumentId_fkey" FOREIGN KEY ("coachDocumentId") REFERENCES "CoachDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSignature" ADD CONSTRAINT "DocumentSignature_intakePacketDocumentId_fkey" FOREIGN KEY ("intakePacketDocumentId") REFERENCES "IntakePacketDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSignature" ADD CONSTRAINT "DocumentSignature_coachDocumentId_fkey" FOREIGN KEY ("coachDocumentId") REFERENCES "CoachDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachSubscription" ADD CONSTRAINT "CoachSubscription_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Raw invariants from the resolved legacy migrations are not representable in schema.prisma.
CREATE UNIQUE INDEX "MealPlan_one_published_per_client_week" ON "MealPlan"("clientId", "weekOf") WHERE (status = 'PUBLISHED');
CREATE UNIQUE INDEX "TrainingProgram_one_published_per_client" ON "TrainingProgram"("clientId") WHERE (status = 'PUBLISHED');
ALTER TABLE "AiWorkoutSession" ADD CONSTRAINT "AiWorkoutSession_modality_check" CHECK ("modality" IN ('STRENGTH', 'CARDIO'));
