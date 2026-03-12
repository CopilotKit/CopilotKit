// Service pricing as percentage of base cost
export const SERVICE_COSTS = {
  PhoneService: 0.15, // 15% of base
  MultipleLines: 0.10, // 10% of base
  OnlineSecurity: 0.08,
  OnlineBackup: 0.08,
  DeviceProtection: 0.10,
  TechSupport: 0.12,
  StreamingTV: 0.18,
  StreamingMovies: 0.18,
};

export const BASE_INTERNET_COST = {
  "DSL": 25.00,
  "Fiber optic": 50.00,
  "No": 0,
};

export function calculateMonthlyCharges(customer: any): {
  baseInternet: number;
  services: Record<string, number>;
  total: number;
  breakdown: string[];
} {
  const base = BASE_INTERNET_COST[customer.InternetService as keyof typeof BASE_INTERNET_COST] || 0;
  const services: Record<string, number> = {};
  const breakdown: string[] = [];
  
  // Add base internet
  breakdown.push(`${customer.InternetService} Internet: $${base.toFixed(2)}`);
  
  // Calculate each service cost
  if (customer.PhoneService === "Yes") {
    const cost = base * SERVICE_COSTS.PhoneService;
    services.PhoneService = cost;
    breakdown.push(`Phone Service: $${cost.toFixed(2)}`);
  }
  
  if (customer.MultipleLines === "Yes") {
    const cost = base * SERVICE_COSTS.MultipleLines;
    services.MultipleLines = cost;
    breakdown.push(`Multiple Lines: $${cost.toFixed(2)}`);
  }
  
  if (customer.OnlineSecurity === "Yes") {
    const cost = base * SERVICE_COSTS.OnlineSecurity;
    services.OnlineSecurity = cost;
    breakdown.push(`Online Security: $${cost.toFixed(2)}`);
  }
  
  if (customer.OnlineBackup === "Yes") {
    const cost = base * SERVICE_COSTS.OnlineBackup;
    services.OnlineBackup = cost;
    breakdown.push(`Online Backup: $${cost.toFixed(2)}`);
  }
  
  if (customer.DeviceProtection === "Yes") {
    const cost = base * SERVICE_COSTS.DeviceProtection;
    services.DeviceProtection = cost;
    breakdown.push(`Device Protection: $${cost.toFixed(2)}`);
  }
  
  if (customer.TechSupport === "Yes") {
    const cost = base * SERVICE_COSTS.TechSupport;
    services.TechSupport = cost;
    breakdown.push(`Tech Support: $${cost.toFixed(2)}`);
  }
  
  if (customer.StreamingTV === "Yes") {
    const cost = base * SERVICE_COSTS.StreamingTV;
    services.StreamingTV = cost;
    breakdown.push(`Streaming TV: $${cost.toFixed(2)}`);
  }
  
  if (customer.StreamingMovies === "Yes") {
    const cost = base * SERVICE_COSTS.StreamingMovies;
    services.StreamingMovies = cost;
    breakdown.push(`Streaming Movies: $${cost.toFixed(2)}`);
  }
  
  const total = base + Object.values(services).reduce((sum, cost) => sum + cost, 0);
  
  return { baseInternet: base, services, total, breakdown };
}

export function calculateServiceChange(
  customer: any,
  serviceName: string,
  newValue: "Yes" | "No"
): {
  oldTotal: number;
  newTotal: number;
  difference: number;
  percentageChange: number;
} {
  const currentCalc = calculateMonthlyCharges(customer);
  const oldTotal = currentCalc.total;
  
  // Create modified customer
  const modifiedCustomer = { ...customer, [serviceName]: newValue };
  const newCalc = calculateMonthlyCharges(modifiedCustomer);
  const newTotal = newCalc.total;
  
  const difference = newTotal - oldTotal;
  const percentageChange = (difference / oldTotal) * 100;
  
  return { oldTotal, newTotal, difference, percentageChange };
}