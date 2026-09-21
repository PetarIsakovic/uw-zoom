function shuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function restoreImageQueue(images, saved, random = Math.random) {
  const ids = [...new Set(images.map((image) => image.id))];
  const available = new Set(ids);
  const clean = (values) => [...new Set(Array.isArray(values) ? values : [])].filter((id) => available.has(id));
  let seen = clean(saved?.seen);
  let remaining = clean(saved?.remaining).filter((id) => !seen.includes(id));
  const known = new Set([...seen, ...remaining]);
  remaining.push(...shuffle(ids.filter((id) => !known.has(id)), random));
  if (!remaining.length) {
    const recent = new Set(seen.slice(-Math.ceil(ids.length / 2)));
    remaining = [
      ...shuffle(ids.filter((id) => !recent.has(id)), random),
      ...shuffle(ids.filter((id) => recent.has(id)), random),
    ];
    seen = [];
  }
  return { seen, remaining };
}
