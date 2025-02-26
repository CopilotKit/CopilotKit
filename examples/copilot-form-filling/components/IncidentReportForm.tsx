"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useCopilotAction } from "@copilotkit/react-core";

// Define the form schema with Zod
const formSchema = z.object({
  name: z.string().min(2, {
    message: "Name must be at least 2 characters.",
  }),
  email: z.string().email({
    message: "Please enter a valid email address.",
  }),
  incidentType: z.string({
    required_error: "Please select an incident type.",
  }),
  date: z.date({
    required_error: "Please select the date when the incident occurred.",
  }),
  description: z.string().min(10, {
    message: "Description must be at least 10 characters.",
  }),
  impactLevel: z.string({
    required_error: "Please select an impact level.",
  }),
});

export function IncidentReportForm() {
  // Initialize the form
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      description: "",
      // date and other fields will be undefined by default
    },
  });

  // Handle form submission
  function onSubmit(values: z.infer<typeof formSchema>) {
    // In a real application, you would send this data to your backend
    console.log(values);
    alert("Incident report submitted successfully!");
    form.reset();
  }

  useCopilotAction({
    name: "fillIncidentReportForm",
    description: "Fill out the incident report form",
    parameters: [
      {
        "name": "fullName",
        "type": "string",
        "required": true,
        "description": "The full name of the person reporting the incident"
      },
      {
        "name": "email",
        "type": "string",
        "required": true,
        "description": "The email address of the person reporting the incident"
      },
      {
        "name": "description",
        "type": "string",
        "required": true,
        "description": "The description of the incident"
      },
      {
        "name": "date",
        "type": "string",
        "required": true,
        "description": "The date of the incident"
      },
      {
        "name": "impactLevel",
        "type": "string",
        "required": true,
        "description": "The impact level of the incident"
      },
      {
        "name": "incidentType",
        "type": "string",
        "required": true,
        "description": "The type of incident, must be one of the following: phishing, malware, data_breach, unauthorized_access, ddos, other"
      },
      {
        "name": "incidentLevel",
        "type": "string",
        "required": true,
        "description": "The severity of the incident, must be one of the following: low, medium, high, critical"
      },
      { 
        "name": "incidentDescription",
        "type": "string",
        "required": true,
        "description": "The description of the incident"
      },
    ],
    handler: async (action) => {
      form.setValue("name", action.fullName);
      form.setValue("email", action.email);
      form.setValue("description", action.incidentDescription);
      form.setValue("date", new Date(action.date));
      form.setValue("impactLevel", action.incidentLevel);
      form.setValue("incidentType", action.incidentType);
    },
  });

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Cyber Security Incident Report</CardTitle>
        <CardDescription>
          Report a security incident to our security operations team. We'll respond within 24 hours.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="john.doe@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="incidentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Incident Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select incident type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="phishing">Phishing Attack</SelectItem>
                        <SelectItem value="malware">Malware</SelectItem>
                        <SelectItem value="data_breach">Data Breach</SelectItem>
                        <SelectItem value="unauthorized_access">Unauthorized Access</SelectItem>
                        <SelectItem value="ddos">DDoS Attack</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Date of Incident</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) =>
                            date > new Date() || date < new Date("1900-01-01")
                          }
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="impactLevel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Impact Level</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select impact level" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="critical">Critical - Severe business impact</SelectItem>
                      <SelectItem value="high">High - Significant business impact</SelectItem>
                      <SelectItem value="medium">Medium - Limited business impact</SelectItem>
                      <SelectItem value="low">Low - Minimal business impact</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Incident Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Please provide details about the incident, including what happened, how it was discovered, and any other relevant information."
                      className="min-h-32"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Be as detailed as possible to help us investigate the incident effectively.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full">Submit Incident Report</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
} 