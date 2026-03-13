"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "@/components/ui/sidebar";
import * as Dialog from "@radix-ui/react-dialog";
import { Mail, User } from "lucide-react";
import Image from "next/image";

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 p-2">
          <Image
            src="/icon.png"
            alt="OMAC"
            width={24}
            height={24}
            className="h-6 w-6"
          />
          <h2 className="text-lg font-semibold">OMAC</h2>
        </div>
      </SidebarHeader>
      <SidebarContent></SidebarContent>
      <SidebarFooter>
        <SidebarGroup>
          <div className="space-y-1 px-2">
            <Dialog.Root>
              <Dialog.Trigger asChild>
                <button className="flex w-full items-center gap-2 rounded p-2 hover:bg-accent">
                  <User className="h-4 w-4" />
                  <span>Update Profile</span>
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black opacity-30" />
                <Dialog.Content className="fixed top-1/2 left-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded p-6 bg-white shadow-lg">
                  <Dialog.Title className="text-lg font-semibold mb-4">
                    Update Profile
                  </Dialog.Title>
                  <form className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        First Name
                      </label>
                      <Input
                        type="text"
                        name="firstName"
                        placeholder="First Name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Last Name
                      </label>
                      <Input
                        type="text"
                        name="lastName"
                        placeholder="Last Name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Email Address
                      </label>
                      <Input
                        type="email"
                        name="email"
                        placeholder="Email Address"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Dialog.Close asChild>
                        <Button variant="outline" type="button">
                          Cancel
                        </Button>
                      </Dialog.Close>
                      <Button type="submit">Save</Button>
                    </div>
                  </form>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <button className="flex w-full items-center gap-2 rounded p-2 hover:bg-accent">
              <Mail className="h-4 w-4" />
              <span>Connect Gmail</span>
              <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse"></div>
            </button>
          </div>
          <div className="px-4 py-2 text-sm text-muted-foreground">
            Version 0.0.1
          </div>
        </SidebarGroup>
      </SidebarFooter>
    </Sidebar>
  );
}
