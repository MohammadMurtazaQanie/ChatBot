export function normalizeSourcesList(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const normalized = [];
  let inSources = false;
  let nextNumber = 1;

  function addSource(rawSource) {
    const source = rawSource.trim();
    if (!source) return;

    const orderedMatch = source.match(/^(\d+)[.)]\s+(.+)/);
    if (orderedMatch) {
      const sourceNumber = Number(orderedMatch[1]);
      normalized.push(`${sourceNumber}. ${orderedMatch[2]}`);
      nextNumber = sourceNumber + 1;
      return;
    }

    const withoutBullet = source.replace(/^[-*•]\s+/, "");
    normalized.push(`${nextNumber}. ${withoutBullet}`);
    nextNumber += 1;
  }

  for (const line of lines) {
    if (!inSources) {
      const headingMatch = line.match(/^\s*((?:\*\*)?Sources:(?:\*\*)?)\s*(.*)$/i);
      if (!headingMatch) {
        normalized.push(line);
        continue;
      }

      inSources = true;
      normalized.push(headingMatch[1]);
      addSource(headingMatch[2]);
      continue;
    }

    if (!line.trim()) {
      normalized.push(line);
      continue;
    }

    addSource(line);
  }

  return normalized.join("\n");
}
