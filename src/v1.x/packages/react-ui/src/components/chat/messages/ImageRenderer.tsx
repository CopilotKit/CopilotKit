import React, { useState } from "react";
import { ImageRendererProps } from "../props";

/**
 * Default image rendering component that can be customized by users.
 * Uses CSS classes for styling so users can override styles.
 */
export const ImageRenderer: React.FC<ImageRendererProps> = ({ image, content, className = "" }) => {
  const [imageError, setImageError] = useState(false);
  const imageSrc = `data:image/${image.format};base64,${image.bytes}`;
  const altText = content || "User uploaded image";

  const handleImageError = () => {
    setImageError(true);
  };

  if (imageError) {
    return (
      <div className={`copilotKitImageRendering copilotKitImageRenderingError ${className}`}>
        <div className="copilotKitImageRenderingErrorMessage">Failed to load image</div>
        {content && <div className="copilotKitImageRenderingContent">{content}</div>}
      </div>
    );
  }

  return (
    <div className={`copilotKitImageRendering ${className}`}>
      <img
        src={imageSrc}
        alt={altText}
        className="copilotKitImageRenderingImage"
        onError={handleImageError}
      />
      {content && <div className="copilotKitImageRenderingContent">{content}</div>}
    </div>
  );
};
