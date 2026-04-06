import React, { useState } from "react";
import { ImageRendererProps } from "../props";

/**
 * @deprecated Use `CopilotChatAttachmentRenderer` from `@copilotkit/react-core/v2` instead.
 * `ImageRenderer` only handles images. The v2 attachment renderer supports images, audio, video, and documents.
 * See https://docs.copilotkit.ai/migration-guides/migrate-attachments
 * @since 1.56.0
 */
export const ImageRenderer: React.FC<ImageRendererProps> = ({
  image,
  source,
  content,
  className = "",
}) => {
  const [imageError, setImageError] = useState(false);

  // Determine image src from either legacy ImageData or new InputContentSource
  let imageSrc: string;
  if (source) {
    imageSrc =
      source.type === "url"
        ? source.value
        : `data:${source.mimeType};base64,${source.value}`;
  } else if (image) {
    imageSrc = `data:image/${image.format};base64,${image.bytes}`;
  } else {
    return null;
  }

  const altText = content || "User uploaded image";

  if (imageError) {
    return (
      <div
        className={`copilotKitImageRendering copilotKitImageRenderingError ${className}`}
      >
        <div className="copilotKitImageRenderingErrorMessage">
          Failed to load image
        </div>
        {content && (
          <div className="copilotKitImageRenderingContent">{content}</div>
        )}
      </div>
    );
  }

  return (
    <div className={`copilotKitImageRendering ${className}`}>
      <img
        src={imageSrc}
        alt={altText}
        className="copilotKitImageRenderingImage"
        onError={() => setImageError(true)}
      />
      {content && (
        <div className="copilotKitImageRenderingContent">{content}</div>
      )}
    </div>
  );
};
