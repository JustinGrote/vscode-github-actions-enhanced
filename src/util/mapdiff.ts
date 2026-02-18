import equal from "fast-deep-equal/es6";

/** Finds the keys that are different, for purposes of informing changes */
export function mapDiff<K, V>(
  map1: Map<K, V>,
  map2: Map<K, V>,
  deepEqual: (a: V, b: V) => boolean = (a, b) => equal(a, b)
): K[] {
  const differentKeys: K[] = [];

  // Check keys in map1
  for (const key of map1.keys()) {
    if (!map2.has(key)) {
      differentKeys.push(key);
    } else if (!deepEqual(map1.get(key)!, map2.get(key)!)) {
      differentKeys.push(key);
    }
  }

  // Check keys only in map2
  for (const key of map2.keys()) {
    if (!map1.has(key)) {
      differentKeys.push(key);
    }
  }

  return differentKeys;
}
