// server/utils/sanitization-utils.ts

/**
 * Sanitizes a comment string to remove any internal system notes before
 * displaying it to a user.
 * @param comment The comment string to sanitize.
 * @returns The sanitized comment, or null if it was an internal note.
 */
export function sanitizeInternalComments(comment: string | null | undefined): string | null {
    if (!comment) return null;

    const internalPatterns = [
        /User repeated ambiguous time/i,
        /AI reasoning:/i,
        /System note:/i,
        /Validation flag:/i
    ];

    // If the comment matches any internal pattern, treat it as empty.
    if (internalPatterns.some(pattern => pattern.test(comment))) {
        return null;
    }

    return comment;
}