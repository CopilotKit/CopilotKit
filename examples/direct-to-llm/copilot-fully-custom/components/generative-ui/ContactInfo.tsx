import { useState } from "react";
import TextInput from "@leafygreen-ui/text-input";
import Button from "@leafygreen-ui/button";
import TextArea from "@leafygreen-ui/text-area";
import Card from "@leafygreen-ui/card";
import Icon from "@leafygreen-ui/icon";

interface ContactInfoProps {
  onSubmit: (form: any) => void;
}

export default function ContactInfo({ onSubmit }: ContactInfoProps) {
  // Add state for form fields
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    funFact: ''
  });

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [field]: e.target.value
    });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <Card className="flex flex-col gap-2 border-emerald-500 shadow-lg">
        <TextInput label="First Name" onChange={handleChange('firstName')} value={formData.firstName} placeholder="John"/>
        <TextInput label="Last Name" onChange={handleChange('lastName')} value={formData.lastName} placeholder="Doe"/>
        <TextInput label="Email" onChange={handleChange('email')} value={formData.email} placeholder="john.doe@example.com"/>
        <TextInput label="Phone" onChange={handleChange('phone')} value={formData.phone} placeholder="(123) 456-7890"/>
        <TextArea label="Fun Fact" onChange={handleChange('funFact')} value={formData.funFact} placeholder="I love to code!" />
        <Button type="submit"className="mt-4" leftGlyph={<Icon glyph="Checkmark" />}>Submit</Button>
      </Card>
    </form>
  );
}
