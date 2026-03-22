-- AlterEnum: add INTAKE_SENT, INTAKE_SUBMITTED to ConsultationStage
ALTER TYPE "ConsultationStage" ADD VALUE 'INTAKE_SENT';
ALTER TYPE "ConsultationStage" ADD VALUE 'INTAKE_SUBMITTED';
