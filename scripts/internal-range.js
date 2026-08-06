/**
 * The semver range to use for internal @eloquentjs/* cross-dependencies.
 *
 * `^0.0.7` allows *nothing*: a caret on 0.0.x pins the exact patch, so every
 * package had to be republished in lockstep for any patch release. Below 1.0.0
 * we emit an explicit range that admits patches; from 1.0.0 the caret behaves
 * as expected.
 *
 * @param {string} version e.g. '0.0.8' or '1.2.0' or '0.1.0-beta.1'
 * @returns {string} the range to write into package.json
 */
export function internalRange(version) {
  const [major, minor] = String(version).split('.').map(n => parseInt(n, 10))
  const prerelease = String(version).includes('-')

  // A prerelease has to be matched exactly, or npm resolves to the last stable.
  if (prerelease) return version

  if (major > 0) return `^${version}`
  if (minor > 0) return `>=${version} <0.${minor + 1}.0`
  return `>=${version} <0.1.0`
}
