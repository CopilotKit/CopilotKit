import { Mail, Phone, MapPin, Send, CheckCircle, Clock } from "lucide-react";
import React, { useState } from "react";

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleInputChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Form submitted:", formData);
    setIsSubmitted(true);
    setTimeout(() => setIsSubmitted(false), 3000);
  };

  const contactInfo = [
    {
      icon: <Mail className="h-6 w-6" />,
      title: "Email",
      detail: "hello@solestyle.com",
      description: "We respond within 24 hours",
    },
    {
      icon: <Phone className="h-6 w-6" />,
      title: "Phone",
      detail: "+1 (555) 123-4567",
      description: "Monday to Friday, 9am to 6pm PST",
    },
    {
      icon: <MapPin className="h-6 w-6" />,
      title: "Store",
      detail: "123 Fashion District, Los Angeles, CA 90015",
      description: "Visit our flagship store",
    },
  ];

  const subjects = [
    "General Inquiry",
    "Order Support",
    "Returns & Exchanges",
    "Product Information",
    "Partnership Opportunities",
    "Other",
  ];

  return (
    <div className="bg-stone-50 dark:bg-gray-900">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-stone-50 via-amber-50/30 to-stone-100 py-32 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h1 className="mb-8 text-5xl font-extralight tracking-tight text-gray-900 sm:text-6xl dark:text-white">
            Get in Touch
          </h1>
          <p className="mx-auto max-w-4xl text-xl leading-relaxed font-light text-gray-600 dark:text-gray-300">
            Have questions about our products, need help with an order, or want
            to share feedback? We'd love to hear from you and help you find your
            perfect pair.
          </p>
        </div>
      </div>

      {/* Contact Section */}
      <div className="bg-white py-32 dark:bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-20 lg:grid-cols-3">
            {/* Contact Information */}
            <div className="lg:col-span-1">
              <h2 className="mb-10 text-3xl font-extralight tracking-tight text-gray-900 dark:text-white">
                Contact Information
              </h2>
              <div className="space-y-10">
                {contactInfo.map((info, index) => (
                  <div key={index} className="group flex items-start">
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 transition-transform duration-300 group-hover:scale-110 dark:bg-amber-900/30">
                      <div className="text-amber-600 dark:text-amber-500">
                        {info.icon}
                      </div>
                    </div>
                    <div className="ml-6">
                      <h3 className="text-xl font-light tracking-wide text-gray-900 dark:text-white">
                        {info.title}
                      </h3>
                      <p className="mb-2 font-light tracking-wide text-amber-600 dark:text-amber-500">
                        {info.detail}
                      </p>
                      <p className="font-light text-gray-600 dark:text-gray-300">
                        {info.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-16 bg-stone-50 p-8 dark:bg-gray-800">
                <div className="mb-4 flex items-center">
                  <Clock className="mr-3 h-6 w-6 text-amber-600 dark:text-amber-500" />
                  <h3 className="text-xl font-light tracking-wide text-gray-900 dark:text-white">
                    Store Hours
                  </h3>
                </div>
                <div className="space-y-2 font-light text-gray-600 dark:text-gray-300">
                  <div className="flex justify-between">
                    <span>Monday - Friday</span>
                    <span>10am - 8pm</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Saturday</span>
                    <span>10am - 6pm</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sunday</span>
                    <span>12pm - 5pm</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div className="lg:col-span-2">
              <div className="bg-stone-50 p-12 dark:bg-gray-800">
                <h2 className="mb-10 text-3xl font-extralight tracking-tight text-gray-900 dark:text-white">
                  Send us a Message
                </h2>

                {isSubmitted ? (
                  <div className="py-16 text-center">
                    <CheckCircle className="mx-auto mb-6 h-20 w-20 text-amber-600 dark:text-amber-500" />
                    <h3 className="mb-4 text-2xl font-light tracking-wide text-gray-900 dark:text-white">
                      Message Sent Successfully
                    </h3>
                    <p className="leading-relaxed font-light text-gray-600 dark:text-gray-300">
                      Thank you for reaching out. We'll get back to you within
                      24 hours.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-8">
                    <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                      <div>
                        <label
                          htmlFor="name"
                          className="mb-3 block text-sm font-light tracking-wide text-gray-700 uppercase dark:text-gray-300"
                        >
                          Full Name *
                        </label>
                        <input
                          type="text"
                          id="name"
                          name="name"
                          value={formData.name}
                          onChange={handleInputChange}
                          required
                          className="w-full border-0 border-b border-gray-300 bg-transparent px-0 py-4 text-lg font-light text-gray-900 transition-colors duration-300 focus:border-amber-600 focus:ring-0 dark:border-gray-600 dark:text-white dark:focus:border-amber-500"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="email"
                          className="mb-3 block text-sm font-light tracking-wide text-gray-700 uppercase dark:text-gray-300"
                        >
                          Email Address *
                        </label>
                        <input
                          type="email"
                          id="email"
                          name="email"
                          value={formData.email}
                          onChange={handleInputChange}
                          required
                          className="w-full border-0 border-b border-gray-300 bg-transparent px-0 py-4 text-lg font-light text-gray-900 transition-colors duration-300 focus:border-amber-600 focus:ring-0 dark:border-gray-600 dark:text-white dark:focus:border-amber-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label
                        htmlFor="subject"
                        className="mb-3 block text-sm font-light tracking-wide text-gray-700 uppercase dark:text-gray-300"
                      >
                        Subject *
                      </label>
                      <select
                        id="subject"
                        name="subject"
                        value={formData.subject}
                        onChange={handleInputChange}
                        required
                        className="w-full border-0 border-b border-gray-300 bg-transparent px-0 py-4 text-lg font-light text-gray-900 transition-colors duration-300 focus:border-amber-600 focus:ring-0 dark:border-gray-600 dark:text-white dark:focus:border-amber-500"
                      >
                        <option value="">Select a subject</option>
                        {subjects.map((subject, index) => (
                          <option
                            key={index}
                            value={subject}
                            className="bg-white dark:bg-gray-800"
                          >
                            {subject}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="message"
                        className="mb-3 block text-sm font-light tracking-wide text-gray-700 uppercase dark:text-gray-300"
                      >
                        Message *
                      </label>
                      <textarea
                        id="message"
                        name="message"
                        value={formData.message}
                        onChange={handleInputChange}
                        required
                        rows={6}
                        className="w-full resize-none border-0 border-b border-gray-300 bg-transparent px-0 py-4 text-lg font-light text-gray-900 transition-colors duration-300 focus:border-amber-600 focus:ring-0 dark:border-gray-600 dark:text-white dark:focus:border-amber-500"
                        placeholder="Tell us how we can help you..."
                      />
                    </div>
                    <div className="pt-8">
                      <button
                        type="submit"
                        className="group flex items-center bg-amber-600 px-12 py-5 text-lg font-light tracking-wide text-white transition-all duration-300 hover:bg-amber-700 hover:shadow-lg hover:shadow-amber-600/25"
                      >
                        Send Message
                        <Send className="ml-3 h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="bg-stone-50 py-24 dark:bg-gray-800">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <h2 className="mb-6 text-4xl font-extralight tracking-tight text-gray-900 dark:text-white">
              Frequently Asked Questions
            </h2>
            <p className="text-lg leading-relaxed font-light text-gray-600 dark:text-gray-300">
              Quick answers to common questions about our products and services
            </p>
          </div>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <div className="rounded-lg bg-white p-6 dark:bg-gray-900">
              <h3 className="mb-3 text-lg font-medium text-gray-900 dark:text-white">
                What is your return policy?
              </h3>
              <p className="font-light text-gray-600 dark:text-gray-300">
                We offer a 30-day return policy for unworn items in original
                packaging. Returns are free and easy through our online portal.
              </p>
            </div>
            <div className="rounded-lg bg-white p-6 dark:bg-gray-900">
              <h3 className="mb-3 text-lg font-medium text-gray-900 dark:text-white">
                Do you offer international shipping?
              </h3>
              <p className="font-light text-gray-600 dark:text-gray-300">
                Yes, we ship worldwide! International shipping rates and
                delivery times vary by location and are calculated at checkout.
              </p>
            </div>
            <div className="rounded-lg bg-white p-6 dark:bg-gray-900">
              <h3 className="mb-3 text-lg font-medium text-gray-900 dark:text-white">
                How do I find my size?
              </h3>
              <p className="font-light text-gray-600 dark:text-gray-300">
                Each product page includes a detailed size guide. We also offer
                virtual fitting consultations to help you find the perfect fit.
              </p>
            </div>
            <div className="rounded-lg bg-white p-6 dark:bg-gray-900">
              <h3 className="mb-3 text-lg font-medium text-gray-900 dark:text-white">
                Are your shoes authentic?
              </h3>
              <p className="font-light text-gray-600 dark:text-gray-300">
                Absolutely! We work directly with authorized retailers and
                brands to ensure 100% authenticity of all products we sell.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
