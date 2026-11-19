import type { TrainingDayGroup } from "@/types/training";

export function trainingEditorSignature(program: {
  days: TrainingDayGroup[];
  weeklyFrequency?: number | null;
  clientNotes?: string | null;
  injuries?: string | null;
  equipment?: string | null;
  templateSourceId?: string | null;
}) {
  return JSON.stringify({
    days: program.days.map((day) => ({
      dayName: day.dayName,
      blocks: day.blocks.map((block) => ({
        type: block.type, title: block.title, content: block.content,
      })),
    })),
    weeklyFrequency: program.weeklyFrequency ?? null,
    clientNotes: program.clientNotes || null,
    injuries: program.injuries || null,
    equipment: program.equipment || null,
    templateSourceId: program.templateSourceId || null,
  });
}
