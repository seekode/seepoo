import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Charge le fichier .poo-draft.json s'il existe
 */
export async function loadDraftFile(rootDir) {
  const draftPath = path.join(rootDir, '.poo-draft.json');
  try {
    const content = await fs.readFile(draftPath, 'utf-8');
    const parsed = JSON.parse(content);

    const normalizedClasses = Array.isArray(parsed.classes)
      ? parsed.classes
      : Array.isArray(parsed.classes?.classes)
      ? parsed.classes.classes
      : [];

    const normalizedPositions =
      parsed.positions || parsed.classes?.positions || {};

    const normalizedNotes = Array.isArray(parsed.notes)
      ? parsed.notes
      : Array.isArray(normalizedPositions.__notes__)
      ? normalizedPositions.__notes__
      : [];

    return {
      version: parsed.version || '1.0',
      positions: normalizedPositions,
      classes: normalizedClasses,
      notes: normalizedNotes
    };
  } catch {
    return { version: '1.0', positions: {}, classes: [], notes: [] };
  }
}

/**
 * Fusionne et sauvegarde une mise à jour partielle dans .poo-draft.json
 */
export async function saveDraftPatch(rootDir, draftPatch) {
  const draftPath = path.join(rootDir, '.poo-draft.json');
  const existingDraft = await loadDraftFile(rootDir);
  const isArrayInput = Array.isArray(draftPatch);

  const payload = {
    version: '1.0',
    updatedAt: new Date().toISOString(),
    positions: isArrayInput
      ? existingDraft.positions
      : draftPatch.positions ?? existingDraft.positions,
    classes: isArrayInput
      ? draftPatch
      : draftPatch.classes ?? existingDraft.classes,
    notes: isArrayInput
      ? existingDraft.notes || []
      : draftPatch.notes ?? existingDraft.notes ?? []
  };

  await fs.writeFile(draftPath, JSON.stringify(payload, null, 2), 'utf-8');
  return payload;
}
