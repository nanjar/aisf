-- V1.3: one deterministic S3 object key represents one logical file/version.
-- Keep the newest metadata row if historical retries already created duplicates.
DELETE FROM "artifact_objects" a
USING "artifact_objects" newer
WHERE a."object_key" = newer."object_key"
  AND (a."created_at" < newer."created_at"
       OR (a."created_at" = newer."created_at" AND a."id" < newer."id"));

CREATE UNIQUE INDEX "artifact_objects_object_key_key"
  ON "artifact_objects"("object_key");
