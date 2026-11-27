import React, { createContext, useContext, useState, useEffect } from 'react';

export const LANGUAGES = {
  EN: 'en',
  TA: 'ta',
};

export const translations = {
  en: {
    // Brand & App
    appName: 'ORDER-TO-AUDIT',
    appSubtitle: 'Food Manufacturing ERP',
    tagline: 'Statutory Food-Manufacturing Enterprise Resource Planning',
    productionBadge: 'Order-to-Audit ERP • v1.0.0 Production',

    // Language options
    langEnglish: 'English',
    langTamil: 'தமிழ் (Tamil)',

    // Navigation Groups
    navCoreOperations: 'Core Operations',
    navMasterData: 'Master Data',
    navSupplyProduction: 'Supply & Production',
    navSalesReceipts: 'Sales & Receipts',
    navFinanceCompliance: 'Finance & Compliance',

    // Navigation Items
    navDashboard: 'Dashboard',
    navItems: 'Items & Products',
    navBoms: 'Bill of Materials',
    navParties: 'Parties (Cust/Supp)',
    navWarehouses: 'Warehouses',
    navUsers: 'User Management',
    navPurchases: 'Purchase Bills',
    navInventory: 'Inventory & Batches',
    navProduction: 'Production & Runs',
    navProductionCosting: 'Production Costing',
    navSalesOrders: 'Sales Orders',
    navFulfilment: 'Order Fulfilment',
    navInvoices: 'Tax Invoices',
    navCustomerReceipts: 'Customer Receipts',
    navSupplierPayments: 'Supplier Payments',
    navAccounting: 'Accounting & GL',
    navReports: 'Reports & Analytics',
    navAudit: 'Audit Trail Logs',

    // Roles & Personas
    activeRole: 'Active Role',
    roleOwner: 'Managing Director (Owner)',
    roleAdmin: 'Factory Admin Desk',
    roleSupervisor: 'Floor Supervisor',
    roleSalesman: 'Salesman A (Tamil Nadu)',
    roleSalesmanB: 'Salesman B (Karnataka)',
    roleAuditor: 'Statutory Auditor',

    // Header & Global Actions
    logout: 'Logout',
    notifications: 'Notifications',
    noNotifications: 'No notifications at this time',
    markAllRead: 'Mark all as read',
    viewAll: 'View all',
    search: 'Search...',
    filter: 'Filter',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    actions: 'Actions',
    status: 'Status',
    date: 'Date',
    total: 'Total',
    quantity: 'Quantity',

    // Login Page
    signIn: 'Sign In',
    signInAccount: 'Sign in to your enterprise portal',
    username: 'Username',
    password: 'Password',
    signingIn: 'Signing in...',
    quickPersonaLogin: 'Instant Persona Switcher (Verified Evaluation)',
    clickToSwitch: 'Click any role below to instantly log in as that user:',

    // Fulfilment & Sales
    fulfilmentTitle: 'Sales Order Fulfilment & Dispatch',
    fulfilmentSubtitle: 'Live stock allocation, FEFO batch assignment, GST tax invoice generation, and production requirement workflow.',
    tabReadyToDispatch: 'Ready to Dispatch',
    tabStockShortages: 'Stock Shortages',
    tabAllApproved: 'All Approved Orders',
    statTotalApproved: 'Total Approved Orders',
    statReadyToDispatch: 'Ready to Dispatch',
    statStockShortage: 'Stock Shortages',
    statPendingProduction: 'Pending Production',
    orderNumber: 'Order #',
    customer: 'Customer',
    orderedQty: 'Ordered Qty',
    dispatchedQty: 'Dispatched',
    remainingQty: 'Remaining',
    stockAvailable: 'Stock Available',
    shortageQty: 'Shortage',
    btnDispatch: 'Dispatch',
    btnDetails: 'Details',
    btnProductionReq: 'Production Req',
    modalProdReqTitle: 'Production Requirement',
    modalProdReqSubtitle: 'Checking Bill of Materials & store raw material inventory...',
    targetProduct: 'Target Product',
    salesOrder: 'Sales Order',
    prodQtyNeeded: 'Production Qty Needed',
    bomCode: 'BOM Code',
    bomCheckTitle: 'BOM Raw Material Availability Check',
    ingredient: 'Ingredient',
    stdQty: 'Std Qty',
    requiredQty: 'Required Qty',
    availableStock: 'Available Stock',
    materialShortage: 'Material Shortage',
    btnRaisePR: 'Raise PR',
    btnInitiateProduction: 'Initiate Production Run',
    allMaterialsAvailable: 'All required raw materials are currently available in store! Ready to schedule production run.',
    materialShortagesDetected: 'Raw material shortages detected. Raise Procurement Requirements (PR) or purchase bills before issuing materials.',

    // Common Badges
    badgeReady: 'Ready to Dispatch',
    badgeShortage: 'Stock Shortage',
    badgePartial: 'Partially Available',
    badgeFulfilled: 'Fully Dispatched',
    badgePendingReview: 'Pending Review',
    badgeScheduled: 'Scheduled',
    badgeInProduction: 'In Production',
    badgeSufficient: 'Sufficient',
  },

  ta: {
    // Brand & App
    appName: 'ஆர்டர்-டூ-ஆடிட்',
    appSubtitle: 'உணவு உற்பத்தி ஈ.ஆர்.பி (ERP)',
    tagline: 'சட்டப்பூர்வ உணவு உற்பத்தி நிறுவன மேலாண்மை மென்பொருள்',
    productionBadge: 'ஆர்டர்-டூ-ஆடிட் ஈ.ஆர்.பி • பதிப்பு 1.0.0 நேரலை',

    // Language options
    langEnglish: 'English',
    langTamil: 'தமிழ் (Tamil)',

    // Navigation Groups
    navCoreOperations: 'முதன்மை செயல்பாடுகள்',
    navMasterData: 'அடிப்படை தரவுகள் (Master)',
    navSupplyProduction: 'விநியோகம் & உற்பத்தி',
    navSalesReceipts: 'விற்பனை & ரசீதுகள்',
    navFinanceCompliance: 'நிதி & சட்ட இணக்கம்',

    // Navigation Items
    navDashboard: 'முகப்புப்பலகை (Dashboard)',
    navItems: 'பொருட்கள் & தயாரிப்புகள்',
    navBoms: 'மூலப்பொருள் செய்முறை (BOM)',
    navParties: 'வாடிக்கையாளர் / விற்பனையாளர்',
    navWarehouses: 'கிடங்குகள் (Warehouses)',
    navUsers: 'பயனர் மேலாண்மை',
    navPurchases: 'கொள்முதல் விலைப்பட்டியல்கள்',
    navInventory: 'சரக்கு இருப்பு & பேட்ச்கள்',
    navProduction: 'உற்பத்தி & தொகுதிகள் (Runs)',
    navProductionCosting: 'உற்பத்தி அடக்கவிலை (Costing)',
    navSalesOrders: 'விற்பனை ஆணைகள் (Orders)',
    navFulfilment: 'ஆணை நிறைவேற்றம் & அனுப்புகை',
    navInvoices: 'ஜி.எஸ்.டி வரி விலைப்பட்டியல்',
    navCustomerReceipts: 'வாடிக்கையாளர் கட்டணங்கள்',
    navSupplierPayments: 'விற்பனையாளர் கொடுப்பனவுகள்',
    navAccounting: 'கணக்கியல் & பொதுப் பேரேடு',
    navReports: 'அறிக்கைகள் & பகுப்பாய்வு',
    navAudit: 'தணிக்கை பதிவுப் பதிவுகள் (Audit)',

    // Roles & Personas
    activeRole: 'தற்போதைய பொறுப்பு',
    roleOwner: 'நிர்வாக இயக்குநர் (உரிமையாளர்)',
    roleAdmin: 'தொழிற்சாலை நிர்வாகி (Admin)',
    roleSupervisor: 'உற்பத்தி மேற்பார்வையாளர் (Supervisor)',
    roleSalesman: 'விற்பனைப் பிரதிநிதி A (தமிழ்நாடு)',
    roleSalesmanB: 'விற்பனைப் பிரதிநிதி B (கர்நாடகா)',
    roleAuditor: 'சட்டப்பூர்வ தணிக்கையாளர் (Auditor)',

    // Header & Global Actions
    logout: 'வெளியேறு (Logout)',
    notifications: 'அறிவிப்புகள்',
    noNotifications: 'தற்போது புதிய அறிவிப்புகள் இல்லை',
    markAllRead: 'அனைத்தையும் படித்ததாகக் குறிக்கவும்',
    viewAll: 'அனைத்தையும் காண்க',
    search: 'தேடுக...',
    filter: 'வடிகட்டு (Filter)',
    save: 'சேமிக்க',
    cancel: 'ரத்துசெய்',
    delete: 'நீக்கு',
    edit: 'திருத்து',
    actions: 'செயல்கள்',
    status: 'நிலை (Status)',
    date: 'தேதி',
    total: 'மொத்தம்',
    quantity: 'அளவு (Quantity)',

    // Login Page
    signIn: 'உள்நுழைக (Sign In)',
    signInAccount: 'உங்கள் நிறுவன கணக்கில் உள்நுழையவும்',
    username: 'பயனர் பெயர்',
    password: 'கடவுச்சொல்',
    signingIn: 'உள்நுழைகிறது...',
    quickPersonaLogin: 'உடனடி பொறுப்பு மாற்றி (நேரலை மதிப்பீடு)',
    clickToSwitch: 'அந்தப் பயனராக உடனடியாக உள்நுழைய கீழே உள்ள ஏதேனும் ஒரு பொறுப்பைக் கிளிக் செய்யவும்:',

    // Fulfilment & Sales
    fulfilmentTitle: 'விற்பனை ஆணை நிறைவேற்றம் & சரக்கு அனுப்புகை',
    fulfilmentSubtitle: 'நேரலை சரக்கு இருப்பு ஒதுக்கீடு, FEFO பேட்ச் ஒதுக்கீடு, ஜிஎஸ்டி வரிப்பட்டியல் உருவாக்கம் மற்றும் உற்பத்தித் தேவைகள் பணிப்பாய்வு.',
    tabReadyToDispatch: 'அனுப்ப தயார் (Ready)',
    tabStockShortages: 'இருப்பு பற்றாக்குறை (Shortages)',
    tabAllApproved: 'ஒப்புதல் பெற்ற அனைத்து ஆணைகள்',
    statTotalApproved: 'ஒப்புதல் பெற்ற ஆணைகள்',
    statReadyToDispatch: 'அனுப்ப தயார்',
    statStockShortage: 'இருப்பு பற்றாக்குறை',
    statPendingProduction: 'நிலுவையில் உள்ள உற்பத்தி',
    orderNumber: 'ஆணை எண் #',
    customer: 'வாடிக்கையாளர்',
    orderedQty: 'ஆணை அளவு',
    dispatchedQty: 'அனுப்பப்பட்டது',
    remainingQty: 'மீதமுள்ள அளவு',
    stockAvailable: 'கையிருப்பு அளவு',
    shortageQty: 'பற்றாக்குறை',
    btnDispatch: 'அனுப்பு (Dispatch)',
    btnDetails: 'விவரங்கள் (Details)',
    btnProductionReq: 'உற்பத்தித் தேவை (Production Req)',
    modalProdReqTitle: 'உற்பத்தித் தேவை விவரம்',
    modalProdReqSubtitle: 'மூலப்பொருள் செய்முறை (BOM) & சேமிப்பக சரக்கு இருப்பு சரிபார்க்கப்படுகிறது...',
    targetProduct: 'இலக்கு தயாரிப்பு',
    salesOrder: 'விற்பனை ஆணை',
    prodQtyNeeded: 'தேவையான உற்பத்தி அளவு',
    bomCode: 'BOM குறியீடு',
    bomCheckTitle: 'BOM மூலப்பொருள் கிடைக்கும் தன்மை சரிபார்ப்பு',
    ingredient: 'மூலப்பொருள்',
    stdQty: 'நிலையான அளவு',
    requiredQty: 'தேவையான அளவு',
    availableStock: 'கையிருப்பு இருப்பு',
    materialShortage: 'மூலப்பொருள் பற்றாக்குறை',
    btnRaisePR: 'கொள்முதல் கோரிக்கை (PR)',
    btnInitiateProduction: 'உற்பத்தியைத் தொடங்கு (Start Run)',
    allMaterialsAvailable: 'தேவையான அனைத்து மூலப்பொருட்களும் கிடங்கில் உள்ளன! உற்பத்தித் தொகுதியைத் தொடங்கத் தயார்.',
    materialShortagesDetected: 'மூலப்பொருள் பற்றாக்குறை கண்டறியப்பட்டது. பொருட்களை வழங்குவதற்கு முன் கொள்முதல் கோரிக்கை (PR) அல்லது கொள்முதல் ரசீதை உருவாக்கவும்.',

    // Common Badges
    badgeReady: 'அனுப்ப தயார்',
    badgeShortage: 'இருப்பு பற்றாக்குறை',
    badgePartial: 'பகுதி இருப்பு உள்ளது',
    badgeFulfilled: 'முழுமையாக அனுப்பப்பட்டது',
    badgePendingReview: 'மதிப்பாய்வு நிலுவையில்',
    badgeScheduled: 'திட்டமிடப்பட்டது',
    badgeInProduction: 'உற்பத்தியில் உள்ளது',
    badgeSufficient: 'போதுமான அளவு உள்ளது',
  },
};

const LanguageContext = createContext(null);

export const LanguageProvider = ({ children }) => {
  const [language, setLanguageState] = useState(() => {
    try {
      return localStorage.getItem('ota_language') || LANGUAGES.EN;
    } catch {
      return LANGUAGES.EN;
    }
  });

  const setLanguage = (lang) => {
    const chosen = lang === LANGUAGES.TA ? LANGUAGES.TA : LANGUAGES.EN;
    setLanguageState(chosen);
    try {
      localStorage.setItem('ota_language', chosen);
    } catch (e) {
      console.warn('Failed to persist language preference', e);
    }
  };

  const t = (key, fallback = '') => {
    const dict = translations[language] || translations.en;
    if (dict[key] !== undefined) return dict[key];
    if (translations.en[key] !== undefined) return translations.en[key];
    return fallback || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, languages: LANGUAGES }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
