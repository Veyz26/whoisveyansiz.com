<?php
/** GENERATED from python-reference/budget_app/categorise.py by dev/gen_rules.py. Don't edit by hand. */
declare(strict_types=1);

namespace Linen;

final class RuleData
{
    public const GROUPS = ['Housing & utilities' => 'Essentials', 'Groceries' => 'Essentials', 'Fuel & transport' => 'Essentials', 'Phone & internet' => 'Essentials', 'Insurance' => 'Essentials', 'Medical & health' => 'Essentials', 'Debt repayments' => 'Essentials', 'Bank fees' => 'Essentials', 'Interest charged' => 'Essentials', 'Giving' => 'Essentials', 'Eating out' => 'Lifestyle', 'Subscriptions' => 'Lifestyle', 'Personal care' => 'Lifestyle', 'Fitness & leisure' => 'Lifestyle', 'Shopping' => 'Lifestyle', 'Entertainment' => 'Lifestyle', 'Cash withdrawals' => 'Lifestyle', 'Other' => 'Lifestyle', 'Savings & investments' => 'Savings', 'Income' => 'Income', 'Transfers' => 'Transfers'];
    public const BANK_CATEGORY_MAP = ['groceries' => 'Groceries', 'takeaways' => 'Eating out', 'restaurants' => 'Eating out', 'fuel' => 'Fuel & transport', 'transport' => 'Fuel & transport', 'cellphone' => 'Phone & internet', 'internet' => 'Phone & internet', 'digital subscriptions' => 'Subscriptions', 'subscriptions' => 'Subscriptions', 'electricity' => 'Housing & utilities', 'rent' => 'Housing & utilities', 'insurance' => 'Insurance', 'medical' => 'Medical & health', 'pharmacy' => 'Medical & health', 'clothing' => 'Shopping', 'online store' => 'Shopping', 'entertainment' => 'Entertainment', 'cash withdrawal' => 'Cash withdrawals', 'fees' => 'Bank fees', 'interest' => 'Interest charged', 'salary' => 'Income', 'transfer' => 'Transfers', 'investments' => 'Savings & investments', 'loans' => 'Debt repayments', 'personal care' => 'Personal care', 'donations' => 'Giving'];
    /** [category, priority, direction, patterns]; 'regex:' prefix marks a regex rule. */
    public const BUILTIN = [
        ['Bank fees', 300, 'out', ['regex:^#', 'regex:^FEE:', 'MONTHLY ACCOUNT FEE', 'MONTHLY FEE', 'SERVICE FEE', 'ADMIN FEE', 'ACCOUNT FEE', 'NOTIFICATION FEE', 'SMS NOTIFICATION', 'INAPP NOTIFICATION', 'CASH DEPOSIT FEE', 'ATM FEE', 'WITHDRAWAL FEE', 'BANK CHARGES', 'DECLINED FEE', 'UNPAID FEE', 'CARD FEE', 'regex:\\bFEE\\b', 'BANK FEES']],
        ['Interest charged', 300, 'out', ['INTEREST', 'FINANCE CHARGE', 'FINANCE CHARGES', 'INT ON DEBIT', 'OVERDRAFT INTEREST', 'DEBIT INTEREST']],
        ['Income', 290, 'in', ['SALARY', 'SAL', 'PAYROLL', 'WAGES', 'INTEREST', 'CREDIT INTEREST', 'EBUCKS', 'CASHBACK', 'REWARDS', 'REFUND', 'SASSA']],
        ['Eating out', 250, 'out', ['UBER EATS', 'UBEREATS', 'MR D', 'MRD', 'KFC', 'MCDONALDS', 'MCDONALD\'S', 'MCD', 'NANDOS', 'NANDO\'S', 'STEERS', 'WIMPY', 'SPUR', 'DEBONAIRS', 'ROMANS PIZZA', 'STARBUCKS', 'VIDA E CAFFE', 'MUGG & BEAN', 'MUGG AND BEAN', 'OCEAN BASKET', 'BURGER KING', 'FISHAWAYS', 'CHICKEN LICKEN', 'PIZZA', 'RESTAURANT', 'CAFE', 'COFFEE', 'TAKEOUT', 'TAKE-OUT', 'TAKEAWAY', 'TAKEAWAYS', 'DATE NIGHT', 'DATE-DAY']],
        ['Cash withdrawals', 200, 'out', ['ATM', 'CASH WITHDRAWAL', 'CASH WDL', 'CASHSEND']],
        ['Groceries', 200, 'out', ['CHECKERS', 'SIXTY60', 'PICK N PAY', 'PNP', 'WOOLWORTHS', 'SPAR', 'SUPERSPAR', 'KWIKSPAR', 'SHOPRITE', 'FOOD LOVER', 'FOOD LOVERS', 'BOXER', 'USAVE', 'OK FOODS', 'FRUIT & VEG', 'GROCERIES', 'FOOD']],
        ['Fuel & transport', 200, 'out', ['ENGEN', 'SHELL', 'BP', 'SASOL', 'CALTEX', 'TOTALENERGIES', 'ASTRON', 'UBER', 'BOLT', 'GAUTRAIN', 'E-TOLL', 'SANRAL', 'PARKING', 'TOLL', 'PUTCO', 'MYCITI', 'FUEL', 'PETROL']],
        ['Phone & internet', 200, 'any', ['VODACOM', 'MTN', 'CELL C', 'TELKOM', 'RAIN', 'AFRIHOST', 'WEBAFRICA', 'VUMATEL', 'OPENSERVE', 'COOL IDEAS', 'AIRTIME', 'DATA BUNDLE', 'PREPAID AIRTIME', 'PREPAID DATA', 'FIBRE', 'FIBER', 'CELLPHONE']],
        ['Subscriptions', 200, 'out', ['NETFLIX', 'SHOWMAX', 'SPOTIFY', 'DSTV', 'MULTICHOICE', 'YOUTUBE', 'APPLE.COM', 'APPLE COM BILL', 'ICLOUD', 'DISNEY', 'PRIME VIDEO', 'PRIMEVIDEO', 'AMAZON PRIME', 'MICROSOFT', 'ADOBE', 'OPENAI', 'CHATGPT', 'ANTHROPIC', 'CLAUDE.AI', 'GOOGLE ONE', 'AUDIBLE', 'DEEZER', 'BOX OFFICE', 'SUBS', 'SUBSCRIPTIONS', 'STREAMING']],
        ['Fitness & leisure', 200, 'out', ['VIRGIN ACTIVE', 'PLANET FITNESS', 'GYM', 'WORLD OF GOLF', 'GOLF', 'PARKRUN']],
        ['Housing & utilities', 200, 'out', ['ESKOM', 'PREPAID ELEC', 'PREPAID ELECTRICITY', 'ELECTRICITY', 'CITY OF', 'MUNICIPALITY', 'MUNICIPAL', 'RENT', 'RENTAL', 'LEVY', 'LEVIES', 'BODY CORPORATE', 'WATER', 'HOME LOAN', 'BOND', 'UTILITIES', 'HOME SHORTFALL']],
        ['Insurance', 200, 'out', ['MOMENTUM', 'OLD MUTUAL', 'SANLAM', 'OUTSURANCE', 'SANTAM', 'HOLLARD', 'MIWAY', 'KING PRICE', 'BUDGET INSURANCE', '1LIFE', 'CLIENTELE', 'INSURANCE', 'ASSURANCE', 'FUNERAL', 'LIFE COVER']],
        ['Medical & health', 210, 'out', ['DISCOVERY HEALTH', 'MEDICAL AID', 'BONITAS', 'GEMS', 'MEDSHIELD', 'DIS-CHEM', 'DISCHEM', 'PHARMACY', 'DOCTOR', 'DENTIST', 'LANCET', 'PATHCARE', 'AMPATH', 'OPTOMETRIST', 'SPEC-SAVERS', 'SPECSAVERS', 'MEDIWALLET', 'MEDS', 'MEDICATION', 'VITAMINS', 'GLASSES']],
        ['Personal care', 190, 'out', ['CLICKS', 'SALON', 'BARBER', 'HAIRCUT', 'NAIL', 'SUGARING', 'WAX', 'SORBET', 'TOILETRIES']],
        ['Giving', 190, 'out', ['TITHE', 'TITHES', 'CHURCH', 'DONATION', 'GIFT OF THE GIVERS']],
        ['Shopping', 150, 'out', ['TAKEALOT', 'MR PRICE', 'MRP', 'MRPRICEH', 'EDGARS', 'TRUWORTHS', 'PEP', 'ACKERMANS', 'H&M', 'ZARA', 'SUPERBALIST', 'AMAZON', 'MAKRO', 'GAME', 'INCREDIBLE CONNECTION', 'BUILDERS', 'CASHBUILD', 'LEROY MERLIN', 'SHEIN', 'TEMU', 'CNA', 'SPORTSCENE', 'TOTALSPORTS', 'CAPE UNION MART', '@HOME']],
        ['Entertainment', 150, 'out', ['STER KINEKOR', 'NU METRO', 'COMPUTICKET', 'QUICKET', 'STEAM', 'PLAYSTATION', 'XBOX', 'BETWAY', 'HOLLYWOODBETS', 'SUPABETS', 'LOTTO', 'ITHUBA']],
        ['Debt repayments', 180, 'out', ['VEHICLE FINANCE', 'WESBANK', 'MFC', 'CREDIT CARD', 'CC PAYMENT', 'PERSONAL LOAN', 'STUDENT LOAN', 'LOAN', 'RCS', 'TFG', 'DIRECTAXIS', 'ABSA VAF', 'BUDGET FACILITY', 'PAYJUSTNOW', 'PAYFLEX']],
        ['Savings & investments', 180, 'out', ['TFSA', 'TAX FREE', 'TAX-FREE', 'EASYEQUITIES', 'EASY EQUITIES', 'SATRIX', 'ALLAN GRAY', '10X', 'NOTICE DEPOSIT', 'FIXED DEPOSIT', 'SAVINGS POCKET', 'UNIT TRUST', 'RETIREMENT ANNUITY', 'MONEY MARKET']],
        ['Transfers', 160, 'any', ['TRANSFER', 'TRF', 'INTER ACC', 'INTER-ACCOUNT', 'OWN ACCOUNT', 'OWN ACC', 'SAVINGS TRANSFER']],
    ];
}
