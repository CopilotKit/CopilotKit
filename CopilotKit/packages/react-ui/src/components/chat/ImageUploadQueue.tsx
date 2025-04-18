import React from "react";

interface ImageUploadQueueProps {
  images: Array<{ contentType: string; bytes: string }>;
  onRemoveImage: (index: number) => void;
  className?: string;
}

export const ImageUploadQueue: React.FC<ImageUploadQueueProps> = ({
  images,
  onRemoveImage,
  className = "",
}) => {
  if (images.length === 0) return null;

  return (
    <div
      className={`copilotKitImageUploadQueue ${className}`}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
        margin: "8px",
        padding: "8px",
      }}
    >
      {images.map((image, index) => (
        <div
          key={index}
          className="copilotKitImageUploadQueueItem"
          style={{
            position: "relative",
            display: "inline-block",
            width: "60px",
            height: "60px",
            borderRadius: "4px",
            overflow: "hidden",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:${image.contentType};base64,${image.bytes}`}
            alt={`Selected image ${index + 1}`}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
          <button
            onClick={() => onRemoveImage(index)}
            className="copilotKitImageUploadQueueRemoveButton"
            style={{
              position: "absolute",
              top: "2px",
              right: "2px",
              background: "rgba(0,0,0,0.6)",
              color: "white",
              border: "none",
              borderRadius: "50%",
              width: "18px",
              height: "18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: "10px",
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
};
