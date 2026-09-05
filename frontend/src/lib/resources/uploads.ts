import { uploadFile } from "@/lib/api";

export interface UploadedImage {
  url: string;
}

export interface UploadedDocument {
  url: string;
  originalName: string;
}

export const uploadsApi = {
  /** Uploads a single image (JPEG/PNG/WebP, max 5MB — see backend uploads.ts) and returns its public URL. */
  image: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return uploadFile<{ data: UploadedImage }>("/api/uploads/image", formData).then((r) => r.data);
  },
  /** Uploads a single document (PDF/PPT/PPTX/DOC/DOCX, max 20MB) for course material or a homework attachment. */
  document: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return uploadFile<{ data: UploadedDocument }>("/api/uploads/document", formData).then((r) => r.data);
  },
};
