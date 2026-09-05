"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { uploadsApi } from "@/lib/resources/uploads";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui";

/**
 * A single "Upload photo"-style button backed by POST /api/uploads/image.
 * Deliberately not a full dropzone/preview widget — every current caller
 * (student photo, staff photo) already shows the *current* image itself
 * right next to this button, so this component only needs to handle
 * picking a new file and reporting back the resulting URL; the caller
 * decides what to do with it (usually an immediate PATCH + refetch).
 */
export function ImageUploadButton({
  onUploaded,
  label = "Upload photo",
}: {
  onUploaded: (url: string) => void;
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
      const { url } = await uploadsApi.image(file);
      onUploaded(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload the image.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
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
