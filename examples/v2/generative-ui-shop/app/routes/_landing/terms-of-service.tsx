import { Shield, Mail } from "lucide-react";

export default function TOSPage() {
  return (
    <div className="bg-stone-50 dark:bg-gray-900">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-stone-50 via-amber-50/30 to-stone-100 py-32 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <div className="mb-8 flex justify-center">
            <Shield className="h-16 w-16 text-amber-600 dark:text-amber-500" />
          </div>
          <h1 className="mb-8 text-5xl font-extralight tracking-tight text-gray-900 sm:text-6xl dark:text-white">
            Terms of Service
          </h1>
          <p className="mx-auto max-w-3xl text-xl leading-relaxed font-light text-gray-600 dark:text-gray-300">
            Last updated: January 1, 2025
          </p>
        </div>
      </div>

      {/* Content Section */}
      <div className="bg-white py-32 dark:bg-gray-900">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="prose prose-lg dark:prose-invert max-w-none">
            <section className="mb-16">
              <h2 className="mb-6 text-3xl font-light tracking-tight text-gray-900 dark:text-white">
                1. Acceptance of Terms
              </h2>
              <p className="mb-6 text-lg leading-relaxed font-light text-gray-600 dark:text-gray-300">
                By accessing and using EpicStore's services, you accept and
                agree to be bound by the terms and provision of this agreement.
                If you do not agree to abide by the above, please do not use
                this service.
              </p>
            </section>

            <section className="mb-16">
              <h2 className="mb-6 text-3xl font-light tracking-tight text-gray-900 dark:text-white">
                2. Use License
              </h2>
              <p className="mb-6 text-lg leading-relaxed font-light text-gray-600 dark:text-gray-300">
                Permission is granted to temporarily download one copy of the
                materials on EpicStore's website for personal, non-commercial
                transitory viewing only. This is the grant of a license, not a
                transfer of title, and under this license you may not:
              </p>
              <ul className="mb-6 list-inside list-disc space-y-3 text-lg font-light text-gray-600 dark:text-gray-300">
                <li>modify or copy the materials</li>
                <li>
                  use the materials for any commercial purpose or for any public
                  display
                </li>
                <li>
                  attempt to reverse engineer any software contained on
                  EpicStore's website
                </li>
                <li>
                  remove any copyright or other proprietary notations from the
                  materials
                </li>
              </ul>
            </section>

            <section className="mb-16">
              <h2 className="mb-6 text-3xl font-light tracking-tight text-gray-900 dark:text-white">
                3. Service Availability
              </h2>
              <p className="mb-6 text-lg leading-relaxed font-light text-gray-600 dark:text-gray-300">
                EpicStore strives to provide continuous service availability.
                However, we do not guarantee that our services will be available
                at all times. We may suspend or discontinue services for
                maintenance, upgrades, or other operational reasons.
              </p>
            </section>

            <section className="mb-16">
              <h2 className="mb-6 text-3xl font-light tracking-tight text-gray-900 dark:text-white">
                4. User Accounts
              </h2>
              <p className="mb-6 text-lg leading-relaxed font-light text-gray-600 dark:text-gray-300">
                When you create an account with us, you must provide information
                that is accurate, complete, and current at all times. You are
                responsible for safeguarding the password and for all activities
                that occur under your account.
              </p>
            </section>

            <section className="mb-16">
              <h2 className="mb-6 text-3xl font-light tracking-tight text-gray-900 dark:text-white">
                5. Payment Terms
              </h2>
              <p className="mb-6 text-lg leading-relaxed font-light text-gray-600 dark:text-gray-300">
                Payment for our services is due according to the billing cycle
                selected at the time of subscription. Failure to pay may result
                in suspension or termination of service.
              </p>
            </section>

            <section className="mb-16">
              <h2 className="mb-6 text-3xl font-light tracking-tight text-gray-900 dark:text-white">
                6. Data Protection
              </h2>
              <p className="mb-6 text-lg leading-relaxed font-light text-gray-600 dark:text-gray-300">
                We are committed to protecting your data. We implement
                appropriate technical and organizational measures to ensure a
                level of security appropriate to the risk.
              </p>
            </section>

            <section className="mb-16">
              <h2 className="mb-6 text-3xl font-light tracking-tight text-gray-900 dark:text-white">
                7. Limitation of Liability
              </h2>
              <p className="mb-6 text-lg leading-relaxed font-light text-gray-600 dark:text-gray-300">
                In no event shall EpicStore or its suppliers be liable for any
                damages (including, without limitation, damages for loss of data
                or profit, or due to business interruption) arising out of the
                use or inability to use the materials on EpicStore's website.
              </p>
            </section>

            <section className="mb-16">
              <h2 className="mb-6 text-3xl font-light tracking-tight text-gray-900 dark:text-white">
                8. Termination
              </h2>
              <p className="mb-6 text-lg leading-relaxed font-light text-gray-600 dark:text-gray-300">
                We may terminate or suspend your account and bar access to the
                service immediately, without prior notice or liability, under
                our sole discretion, for any reason whatsoever including but not
                limited to a breach of the Terms.
              </p>
            </section>

            <section className="mb-16">
              <h2 className="mb-6 text-3xl font-light tracking-tight text-gray-900 dark:text-white">
                9. Changes to Terms
              </h2>
              <p className="mb-6 text-lg leading-relaxed font-light text-gray-600 dark:text-gray-300">
                EpicStore may revise these terms of service at any time without
                notice. By using this website, you are agreeing to be bound by
                the then current version of these terms of service.
              </p>
            </section>

            <section className="mb-16">
              <h2 className="mb-6 text-3xl font-light tracking-tight text-gray-900 dark:text-white">
                10. Contact Information
              </h2>
              <p className="mb-6 text-lg leading-relaxed font-light text-gray-600 dark:text-gray-300">
                If you have any questions about these Terms of Service, please
                contact us at:
              </p>
              <div className="border-l-4 border-amber-600 bg-stone-50 p-8 dark:border-amber-500 dark:bg-gray-800">
                <div className="flex items-start space-x-4">
                  <Mail className="mt-1 h-6 w-6 text-amber-600 dark:text-amber-500" />
                  <div>
                    <p className="leading-relaxed font-light text-gray-600 dark:text-gray-300">
                      <strong className="font-medium">Email:</strong>{" "}
                      legal@epic-store.com
                      <br />
                      <strong className="font-medium">Phone:</strong> +1 (555)
                      123-4567
                      <br />
                      <strong className="font-medium">Address:</strong> 123
                      Design District, San Francisco, CA 94105
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
