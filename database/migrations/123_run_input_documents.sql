-- Re-run defaults to the last run's inputs: the document ids an analysis run
-- was given (uploads resolved to their filed copy by content hash). The UI
-- pre-selects them in "From Project Files" for the next run.
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS input_document_ids TEXT[];
