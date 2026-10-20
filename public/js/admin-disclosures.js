const STORAGE_KEY = 'cozy-pumpkins.admin-disclosures';

export function bindPersistentDisclosures(disclosures, storage = null) {
  const persistent = [...disclosures].filter((disclosure) => disclosure.dataset.persistKey);
  const getStorage = () => storage ?? globalThis.localStorage;
  let saved = {};

  try {
    const value = getStorage().getItem(STORAGE_KEY);
    if (value) {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed;
    }
  } catch (error) {
    console.warn('Unable to load admin disclosure preferences.', error);
  }

  for (const disclosure of persistent) {
    const open = saved[disclosure.dataset.persistKey];
    if (typeof open === 'boolean') disclosure.open = open;
  }

  const save = () => {
    try {
      getStorage().setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(
        persistent.map((disclosure) => [disclosure.dataset.persistKey, disclosure.open]),
      )));
    } catch (error) {
      console.warn('Unable to save admin disclosure preferences.', error);
    }
  };

  persistent.forEach((disclosure) => disclosure.addEventListener('toggle', save));
}
