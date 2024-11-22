import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stars } from "@/components/Stars";
import { useState, useEffect } from "react";
import { Place } from "@/lib/types";

export interface PlaceFormData {
  name: string;
  description: string;
  address: string;
  rating: number;
}

interface PlaceFormProps {
  onSubmit: (place: Place) => void;
  place?: Place;
  submitLabel?: string;
}

export function PlaceForm({ 
  onSubmit, 
  place, 
  submitLabel = place ? "Save Changes" : "Add Place" 
}: PlaceFormProps) {
  const [name, setName] = useState(place?.name ?? "");
  const [description, setDescription] = useState(place?.description ?? "");
  const [address, setAddress] = useState(place?.address ?? "");
  const [rating, setRating] = useState(place?.rating ?? 0);
  const [hoverRating, setHoverRating] = useState(0);

  useEffect(() => {
    if (place) {
      setName(place.name);
      setDescription(place.description ?? "");
      setAddress(place.address);
      setRating(place.rating);
    }
  }, [place]);

  const handleSubmit = () => {
    onSubmit({
      id: place?.id ?? Date.now().toString(),
      name,
      description,
      address,
      rating,
      latitude: place?.latitude ?? 0,
      longitude: place?.longitude ?? 0,
    });
  };

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Place name</Label>
        <Input 
          id="name" 
          placeholder="Enter place name" 
          value={name} 
          onChange={(e) => setName(e.target.value)}
          className="border-gray-200"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="address">Address</Label>
        <Input 
          id="address" 
          placeholder="Enter address" 
          value={address} 
          onChange={(e) => setAddress(e.target.value)}
          className="border-gray-200"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="description">Description</Label>
        <Input 
          id="description" 
          placeholder="Enter description" 
          value={description} 
          onChange={(e) => setDescription(e.target.value)}
          className="border-gray-200"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="rating">Rating</Label>
        <Stars
          rating={hoverRating || rating}
          interactive
          showNumber={false}
          onHover={setHoverRating}
          onRate={setRating}
        />
      </div>
      <Button onClick={handleSubmit}>{submitLabel}</Button>
    </div>
  );
}
