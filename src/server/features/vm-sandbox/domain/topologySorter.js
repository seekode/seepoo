/**
 * Trie les classes topologiquement pour que toute classe parente (`extends`)
 * soit toujours évaluée dans la VM avant ses classes enfants, quel que soit l'ordre des fichiers.
 */
export function sortClassUnitsTopologically(classUnits) {
  const unitMap = new Map(classUnits.map((u) => [u.className, u]));
  const visited = new Set();
  const sorted = [];

  const visit = (unit) => {
    if (!unit || visited.has(unit.className)) return;
    visited.add(unit.className);
    if (unit.superClass && unitMap.has(unit.superClass)) {
      visit(unitMap.get(unit.superClass));
    }
    sorted.push(unit);
  };

  for (const unit of classUnits) {
    visit(unit);
  }

  return sorted;
}
