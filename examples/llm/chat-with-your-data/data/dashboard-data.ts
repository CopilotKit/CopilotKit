// Sales data with monthly records for the past year
export const salesData = [
  {
    date: "Jan 22",
    Sales: 2890,
    Profit: 2400,
    Expenses: 490,
    Customers: 145
  },
  {
    date: "Feb 22",
    Sales: 1890,
    Profit: 1398,
    Expenses: 492,
    Customers: 112
  },
  {
    date: "Mar 22",
    Sales: 3890,
    Profit: 2980,
    Expenses: 910,
    Customers: 194
  },
  {
    date: "Apr 22",
    Sales: 2890,
    Profit: 2300,
    Expenses: 590,
    Customers: 156
  },
  {
    date: "May 22",
    Sales: 4890,
    Profit: 3200,
    Expenses: 1690,
    Customers: 245
  },
  {
    date: "Jun 22",
    Sales: 3890,
    Profit: 2900,
    Expenses: 990,
    Customers: 187
  },
  {
    date: "Jul 22",
    Sales: 4200,
    Profit: 3100,
    Expenses: 1100,
    Customers: 210
  },
  {
    date: "Aug 22",
    Sales: 4500,
    Profit: 3400,
    Expenses: 1100,
    Customers: 225
  },
  {
    date: "Sep 22",
    Sales: 5100,
    Profit: 3800,
    Expenses: 1300,
    Customers: 255
  },
  {
    date: "Oct 22",
    Sales: 4800,
    Profit: 3600,
    Expenses: 1200,
    Customers: 240
  },
  {
    date: "Nov 22",
    Sales: 5500,
    Profit: 4100,
    Expenses: 1400,
    Customers: 275
  },
  {
    date: "Dec 22",
    Sales: 6800,
    Profit: 5200,
    Expenses: 1600,
    Customers: 340
  }
];

// Product performance data
export const productData = [
  {
    name: "Smartphone",
    sales: 9800,
    growth: 12.5,
    units: 1245
  },
  {
    name: "Graphic Tee",
    sales: 4567,
    growth: 8.2,
    units: 756
  },
  {
    name: "Dishwasher",
    sales: 3908,
    growth: -2.4,
    units: 541
  },
  {
    name: "Blender",
    sales: 2400,
    growth: 5.6,
    units: 320
  },
  {
    name: "Smartwatch",
    sales: 1908,
    growth: -1.8,
    units: 210
  }
];

// Category distribution data
export const categoryData = [
  {
    name: "Electronics",
    value: 35,
    growth: 8.2
  },
  {
    name: "Clothing",
    value: 25,
    growth: 4.5
  },
  {
    name: "Home & Kitchen",
    value: 20,
    growth: 12.1
  },
  {
    name: "Other",
    value: 15,
    growth: -2.3
  },
  {
    name: "Books",
    value: 5,
    growth: 1.5
  }
];

// Regional sales data
export const regionalData = [
  {
    region: "North America",
    sales: 42500,
    marketShare: 38
  },
  {
    region: "Europe",
    sales: 29800,
    marketShare: 26
  },
  {
    region: "Asia Pacific",
    sales: 22400,
    marketShare: 20
  },
  {
    region: "Latin America",
    sales: 9800,
    marketShare: 9
  },
  {
    region: "Middle East & Africa",
    sales: 7500,
    marketShare: 7
  }
];

// Customer demographics data
export const demographicsData = [
  {
    ageGroup: "18-24",
    percentage: 15,
    spending: 2100
  },
  {
    ageGroup: "25-34",
    percentage: 32,
    spending: 3800
  },
  {
    ageGroup: "35-44",
    percentage: 28,
    spending: 4200
  },
  {
    ageGroup: "45-54",
    percentage: 16,
    spending: 3600
  },
  {
    ageGroup: "55+",
    percentage: 9,
    spending: 2900
  }
];

// Helper functions for calculating metrics
export const calculateTotalRevenue = () => {
  return salesData.reduce((total, item) => total + item.Sales, 0);
};

export const calculateTotalProfit = () => {
  return salesData.reduce((total, item) => total + item.Profit, 0);
};

export const calculateTotalCustomers = () => {
  return salesData.reduce((total, item) => total + item.Customers, 0);
};

export const calculateConversionRate = () => {
  const totalCustomers = calculateTotalCustomers();
  const visitors = totalCustomers * 8.13; // Assuming 8.13 visitors per customer
  return ((totalCustomers / visitors) * 100).toFixed(1) + "%";
};

export const calculateAverageOrderValue = () => {
  const totalRevenue = calculateTotalRevenue();
  const totalCustomers = calculateTotalCustomers();
  return (totalRevenue / totalCustomers).toFixed(2);
};

export const calculateProfitMargin = () => {
  const totalRevenue = calculateTotalRevenue();
  const totalProfit = calculateTotalProfit();
  return ((totalProfit / totalRevenue) * 100).toFixed(1) + "%";
}; 