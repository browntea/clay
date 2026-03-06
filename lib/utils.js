/**
 * Shared utility functions.
 */

/**
 * Encode a cwd path into a filesystem-safe directory/file name.
 * Replaces forward slashes and dots with hyphens so that usernames
 * like "jon.doe" don't break session/note lookups.
 *
 * Example: "/Users/jon.doe/my-project" -> "-Users-jon-doe-my-project"
 */
function encodeCwd(cwd) {
  return cwd.replace(/[\/\.]/g, "-");
}

module.exports = {
  encodeCwd: encodeCwd,
};
