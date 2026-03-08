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

-- AddForeignKey
ALTER TABLE "OnboardingForm" ADD CONSTRAINT "OnboardingForm_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingResponse" ADD CONSTRAINT "OnboardingResponse_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingResponse" ADD CONSTRAINT "OnboardingResponse_formId_fkey" FOREIGN KEY ("formId") REFERENCES "OnboardingForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
