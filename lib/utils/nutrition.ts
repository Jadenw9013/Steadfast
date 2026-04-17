export function calculateMacros(protein: number, carbs: number, fat: number) {
  return {
    calories: (protein * 4) + (carbs * 4) + (fat * 9),
    protein,
    carbs,
    fat
  };
}
