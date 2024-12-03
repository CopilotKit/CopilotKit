'use client';

import React, { useMemo, useState, isValidElement, useContext } from "react";
import { ProviderDefinition, ProvidersConfig } from "./utils.ts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";

type Props = {
    children: React.ReactNode;
    providersConfig: ProvidersConfig
    defaultProvider?: string;
}

// @ts-expect-error -- initiating this with null is fine
const ProviderContext = React.createContext<{ provider: ProviderDefinition; providerName: string }>(null)

export function MultiProviderContent({ children, defaultProvider, providersConfig }: Props) {
    const [selectedProvider, setSelectedProvider] = useState<string>(defaultProvider ?? "openai");

    const handleSelectChange = (value: string) => {
        setSelectedProvider(value);
    }

    return (
        <div>
            <Select defaultValue={selectedProvider as string} onValueChange={handleSelectChange}>
                <div className="flex items-center w-full">
                    <h5 className="mr-2">Choose your provider:</h5>
                    <SelectTrigger className="w-[220px]">
                        <SelectValue placeholder="Theme" />
                    </SelectTrigger>
                </div>
                <SelectContent>
                    {
                        Object.entries(providersConfig).map(([key, provider]) => (
                            <SelectItem key={provider.id} value={provider.id}>
                                <div className="flex items-center justify-center">
                                    <img
                                        className="mr-2 rounded-sm"
                                        src={provider.icon}
                                        alt={`${provider.title} logo`}
                                        width={20}
                                        height={20}
                                    />
                                    {provider.title}
                                </div>
                            </SelectItem>
                        ))
                    }
                </SelectContent>
            </Select>
            <ProviderContext.Provider value={{ provider: providersConfig[selectedProvider], providerName: selectedProvider }}>
                <Interpolate>
                    {children}
                </Interpolate>
            </ProviderContext.Provider>
        </div>
    );
}

export function Interpolate({ children }: { children: React.ReactNode; }) {
    const { provider, providerName } = useContext(ProviderContext)

    return useMemo(() => {
        if (!provider) return children;

        const processElement = (element: React.ReactNode): React.ReactNode => {
            if (!element) return element;

            // Handle string elements
            if (typeof element === 'string') {
                const tokenRegex = /{{[^}]+}}/g;
                const lines = element.split('\n');
                const filteredLines = lines.filter(line => {
                    const matches = line.match(tokenRegex);
                    if (!matches) return true;
                    
                    // Check if any token in the line has no value
                    return !matches.some(match => {
                        const propName = match.slice(2, -2).trim();
                        return provider[propName] === undefined;
                    });
                });

                return filteredLines.join('\n').replace(tokenRegex, (match) => {
                    const propName = match.slice(2, -2).trim();
                    const value = provider[propName];
                    return Array.isArray(value) ? value.join('\n').trim() : value.toString().trim();
                });
            }

            // Handle React elements
            if (isValidElement(element)) {
                const processedChildren = React.Children.map(element.props.children, processElement);
                return React.cloneElement(element, { ...element.props, children: processedChildren });
            }

            // Handle arrays
            if (Array.isArray(element)) {
                return element.map(child => processElement(child));
            }

            return element;
        };

        return React.Children.map(children, processElement);
    }, [children, providerName])
}

export function If({ condition, children }: { children: React.ReactNode; condition: [keyof ProviderDefinition, unknown] }) {
    const { provider } = useContext(ProviderContext)
    const [conditionKey, conditionValue] = condition;

    switch(typeof conditionValue) {
        case "boolean":
            return Boolean(provider[conditionKey]) === conditionValue ? <>{children}</> : null;
        default:
            return provider[conditionKey] === conditionValue ? <>{children}</> : null;
    }
}
