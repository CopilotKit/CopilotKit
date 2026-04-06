-- Finance ERP seed data

CREATE TYPE invoice_status AS ENUM ('paid', 'pending', 'overdue', 'draft');
CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE txn_type AS ENUM ('credit', 'debit');
CREATE TYPE txn_status AS ENUM ('completed', 'pending', 'failed');
CREATE TYPE emp_status AS ENUM ('active', 'on-leave', 'terminated');

CREATE TABLE IF NOT EXISTS invoices (
    id VARCHAR PRIMARY KEY,
    number VARCHAR UNIQUE NOT NULL,
    client VARCHAR NOT NULL,
    amount FLOAT NOT NULL,
    currency VARCHAR DEFAULT 'USD',
    status invoice_status DEFAULT 'draft',
    issued_date DATE,
    due_date DATE
);

CREATE TABLE IF NOT EXISTS accounts (
    id VARCHAR PRIMARY KEY,
    code VARCHAR UNIQUE NOT NULL,
    name VARCHAR NOT NULL,
    type account_type,
    balance FLOAT DEFAULT 0,
    currency VARCHAR DEFAULT 'USD'
);

CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR PRIMARY KEY,
    date DATE,
    description VARCHAR,
    amount FLOAT,
    type txn_type,
    category VARCHAR,
    account_code VARCHAR,
    status txn_status DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS inventory (
    id VARCHAR PRIMARY KEY,
    sku VARCHAR UNIQUE NOT NULL,
    name VARCHAR NOT NULL,
    category VARCHAR,
    quantity INTEGER DEFAULT 0,
    reorder_level INTEGER DEFAULT 0,
    unit_cost FLOAT DEFAULT 0,
    location VARCHAR
);

CREATE TABLE IF NOT EXISTS employees (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    email VARCHAR UNIQUE,
    role VARCHAR,
    department VARCHAR,
    start_date DATE,
    status emp_status DEFAULT 'active',
    salary FLOAT DEFAULT 0
);

-- Seed invoices
INSERT INTO invoices VALUES
    ('inv-001', 'INV-2026-001', 'Acme Corp', 45000, 'USD', 'paid', '2026-03-01', '2026-03-31'),
    ('inv-002', 'INV-2026-002', 'Globex Industries', 28500, 'USD', 'pending', '2026-03-10', '2026-04-10'),
    ('inv-003', 'INV-2026-003', 'Initech LLC', 67200, 'USD', 'overdue', '2026-02-15', '2026-03-15'),
    ('inv-004', 'INV-2026-004', 'Massive Dynamic', 18750, 'USD', 'paid', '2026-03-05', '2026-04-05'),
    ('inv-005', 'INV-2026-005', 'Umbrella Corp', 93400, 'USD', 'pending', '2026-03-20', '2026-04-20'),
    ('inv-006', 'INV-2026-006', 'Wayne Enterprises', 124000, 'USD', 'draft', '2026-03-28', '2026-04-28'),
    ('inv-007', 'INV-2026-007', 'Stark Industries', 56300, 'USD', 'paid', '2026-02-20', '2026-03-20'),
    ('inv-008', 'INV-2026-008', 'Soylent Industries', 34500, 'USD', 'overdue', '2026-02-01', '2026-03-01'),
    ('inv-009', 'INV-2026-009', 'Cyberdyne Systems', 51800, 'USD', 'overdue', '2026-02-10', '2026-03-10');

-- Seed accounts
INSERT INTO accounts VALUES
    ('acc-001', '1000', 'Cash & Equivalents', 'asset', 1245000, 'USD'),
    ('acc-002', '1100', 'Accounts Receivable', 'asset', 542500, 'USD'),
    ('acc-003', '1200', 'Inventory', 'asset', 312400, 'USD'),
    ('acc-004', '1500', 'Fixed Assets', 'asset', 890000, 'USD'),
    ('acc-005', '2000', 'Accounts Payable', 'liability', 234500, 'USD'),
    ('acc-006', '2100', 'Short-term Loans', 'liability', 150000, 'USD'),
    ('acc-007', '2500', 'Long-term Debt', 'liability', 520000, 'USD'),
    ('acc-008', '3000', 'Owner''s Equity', 'equity', 1850000, 'USD'),
    ('acc-009', '3100', 'Retained Earnings', 'equity', 642100, 'USD'),
    ('acc-010', '4000', 'Service Revenue', 'revenue', 2847350, 'USD'),
    ('acc-011', '5000', 'Payroll Expense', 'expense', 580000, 'USD'),
    ('acc-012', '5100', 'Operating Expense', 'expense', 625250, 'USD');

-- Seed transactions
INSERT INTO transactions VALUES
    ('txn-001', '2026-03-31', 'Acme Corp - Invoice Payment', 45000, 'credit', 'Revenue', '4000', 'completed'),
    ('txn-002', '2026-03-30', 'AWS Infrastructure', 8420, 'debit', 'Infrastructure', '5100', 'completed'),
    ('txn-003', '2026-03-29', 'Payroll - March Cycle', 48500, 'debit', 'Payroll', '5000', 'completed'),
    ('txn-004', '2026-03-28', 'Stark Industries - Payment', 56300, 'credit', 'Revenue', '4000', 'completed'),
    ('txn-005', '2026-03-27', 'Office Supplies', 2340, 'debit', 'Operations', '5100', 'completed'),
    ('txn-006', '2026-03-26', 'Google Ads Campaign', 12500, 'debit', 'Marketing', '5100', 'pending'),
    ('txn-007', '2026-03-25', 'Massive Dynamic - Payment', 18750, 'credit', 'Revenue', '4000', 'completed'),
    ('txn-008', '2026-03-24', 'Software Licenses Renewal', 5600, 'debit', 'Infrastructure', '5100', 'completed'),
    ('txn-009', '2026-03-23', 'Insurance Premium Q2', 15000, 'debit', 'Operations', '5100', 'pending'),
    ('txn-010', '2026-03-22', 'Contractor Payment - Design', 7800, 'debit', 'Operations', '5100', 'completed'),
    ('txn-011', '2026-03-20', 'Cyberdyne Systems - Partial Payment', 15000, 'credit', 'Revenue', '4000', 'completed'),
    ('txn-012', '2026-03-18', 'Facebook Ads - Q1 Campaign', 18500, 'debit', 'Marketing', '5100', 'completed'),
    ('txn-013', '2026-03-15', 'Payroll - March Cycle 1', 48500, 'debit', 'Payroll', '5000', 'completed'),
    ('txn-014', '2026-03-12', 'Conference Sponsorship - SaaStr', 22000, 'debit', 'Marketing', '5100', 'completed'),
    ('txn-015', '2026-03-08', 'Soylent Industries - Partial Payment', 10000, 'credit', 'Revenue', '4000', 'completed');

-- Seed inventory
INSERT INTO inventory VALUES
    ('item-001', 'HW-SRV-001', 'Dell PowerEdge R750', 'Servers', 12, 5, 8500, 'Warehouse A'),
    ('item-002', 'HW-LAP-001', 'MacBook Pro 16"', 'Laptops', 3, 10, 2499, 'Warehouse B'),
    ('item-003', 'HW-MON-001', 'LG UltraFine 5K', 'Monitors', 28, 15, 1299, 'Warehouse A'),
    ('item-004', 'SW-LIC-001', 'Microsoft 365 E5 License', 'Software', 150, 50, 57, 'Digital'),
    ('item-005', 'HW-NET-001', 'Cisco Catalyst 9300', 'Networking', 0, 3, 4200, 'Warehouse A'),
    ('item-006', 'HW-LAP-002', 'ThinkPad X1 Carbon', 'Laptops', 8, 10, 1849, 'Warehouse B'),
    ('item-007', 'HW-STO-001', 'Synology DS1621+', 'Storage', 6, 3, 1099, 'Warehouse A'),
    ('item-008', 'SW-SEC-001', 'CrowdStrike Falcon', 'Software', 200, 100, 25, 'Digital');

-- Seed employees
INSERT INTO employees VALUES
    ('emp-001', 'Sarah Chen', 'sarah.chen@company.com', 'CFO', 'Finance', '2020-03-15', 'active', 195000),
    ('emp-002', 'Marcus Williams', 'm.williams@company.com', 'VP Engineering', 'Engineering', '2019-08-01', 'active', 185000),
    ('emp-003', 'Priya Patel', 'p.patel@company.com', 'Head of Product', 'Product', '2021-01-10', 'active', 172000),
    ('emp-004', 'James Rodriguez', 'j.rodriguez@company.com', 'Senior Developer', 'Engineering', '2021-06-20', 'active', 145000),
    ('emp-005', 'Emily Thompson', 'e.thompson@company.com', 'HR Director', 'Human Resources', '2020-11-05', 'active', 158000),
    ('emp-006', 'David Kim', 'd.kim@company.com', 'Financial Analyst', 'Finance', '2022-02-14', 'on-leave', 95000),
    ('emp-007', 'Lisa Nakamura', 'l.nakamura@company.com', 'Marketing Manager', 'Marketing', '2021-09-01', 'active', 118000),
    ('emp-008', 'Robert Chen', 'r.chen@company.com', 'DevOps Engineer', 'Engineering', '2022-04-18', 'active', 135000),
    ('emp-009', 'Ana Martinez', 'a.martinez@company.com', 'UX Designer', 'Product', '2023-01-09', 'active', 112000),
    ('emp-010', 'Tom Walsh', 't.walsh@company.com', 'Sales Director', 'Sales', '2020-07-22', 'active', 165000),
    ('emp-011', 'Jordan Blake', 'j.blake@company.com', 'Marketing Coordinator', 'Marketing', '2026-01-15', 'active', 72000);
