"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { uploadsApi } from "@/lib/resources/uploads";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui";

/**
 * A single "Upload file"-style button backed by POST /api/uploads/document
 * (PDF/PPT/PPTX/DOC/DOCX, max 20MB) — the document counterpart of
 * ImageUploadButton, used for course material and homework attachments.
 * Reports back both the resulting URL and the original filename so the
 * caller can pre-fill a title field.
 */
export function DocumentUploadButton({
  onUploaded,
  label = "Upload file",
}: {
  onUploaded: (result: { url: string; originalName: string }) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so choosing the same file again still fires onChange
    if (!file) return;

    setError(null);
    setIsUploading(true);
    try {
      const result = await uploadsApi.document(file);
      onUploaded(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload the file.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.ppt,.pptx,.doc,.docx,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={onChange}
        aria-label={label}
      />
      <Button type="button" variant="outline" size="sm" isLoading={isUploading} onClick={() => inputRef.current?.click()}>
        <Upload className="size-4" aria-hidden="true" />
        {label}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
