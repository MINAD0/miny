export type ContextDocument = { name: string; text: string }

// The slice of stored context that is sent to the model. Kept separate from the
// database row so the suggester stays testable without SQLite.
export type PromptContext = { resume: string; documents: ContextDocument[] }
