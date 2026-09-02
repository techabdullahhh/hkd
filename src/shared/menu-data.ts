/**
 * Seed menu for Hashmi Ka Dera / HKD (Pakistani cuisine).
 *
 * Prices are taken verbatim from the menu information supplied with the
 * project brief and are expressed in whole rupees here (converted to paisa
 * at seed time). Where the brief was ambiguous — category placement of a
 * few curries, the two Chai sizes, and the four deals — a sensible default
 * is used and flagged with `configurableNote`. Admin can adjust everything
 * from Menu / Deals management; nothing here is hard-coded into the UI.
 */

export interface SeedPrice {
  variant: 'STANDARD' | 'HALF' | 'FULL'
  label: string
  price: number // whole rupees
}

export interface SeedProduct {
  name: string
  nameUrdu: string
  category: string
  popular?: boolean
  description?: string
  configurableNote?: string
  prices: SeedPrice[]
}

export interface SeedDealItem {
  productName: string
  variant: 'STANDARD' | 'HALF' | 'FULL'
  quantity: number
}

export interface SeedDeal {
  name: string
  nameUrdu: string
  price: number
  description?: string
  configurableNote?: string
  items: SeedDealItem[]
}

export const SEED_CATEGORIES: { name: string; nameUrdu: string }[] = [
  { name: 'BBQ', nameUrdu: 'باربی کیو' },
  { name: 'Karahi', nameUrdu: 'کڑاہی' },
  { name: 'Daal', nameUrdu: 'دال' },
  { name: 'Sabzi', nameUrdu: 'سبزی' },
  { name: 'Breads', nameUrdu: 'روٹی' },
  { name: 'Sides', nameUrdu: 'اضافی' },
  { name: 'Beverages', nameUrdu: 'مشروبات' },
  { name: 'Deals', nameUrdu: 'ڈیلز' }
]

const std = (price: number): SeedPrice[] => [{ variant: 'STANDARD', label: 'Standard', price }]
const halfFull = (half: number, full: number): SeedPrice[] => [
  { variant: 'HALF', label: 'Half', price: half },
  { variant: 'FULL', label: 'Full', price: full }
]

export const SEED_PRODUCTS: SeedProduct[] = [
  // BBQ
  { name: 'Seekh Kabab', nameUrdu: 'سیخ کباب', category: 'BBQ', popular: true, prices: std(100) },
  { name: 'Malai Boti', nameUrdu: 'ملائی بوٹی', category: 'BBQ', popular: true, prices: std(200) },
  { name: 'Chicken Boti', nameUrdu: 'چکن بوٹی', category: 'BBQ', prices: std(180) },
  { name: 'Chest Piece', nameUrdu: 'چسٹ پیس', category: 'BBQ', prices: std(380) },
  { name: 'Leg Piece', nameUrdu: 'لیگ پیس', category: 'BBQ', prices: std(380) },

  // Karahi
  { name: 'Chicken Karahi', nameUrdu: 'چکن کڑاہی', category: 'Karahi', popular: true, prices: halfFull(800, 1500) },
  { name: 'White Karahi', nameUrdu: 'وائٹ کڑاہی', category: 'Karahi', prices: halfFull(950, 1850) },
  { name: 'Makhni Karahi', nameUrdu: 'مکھنی کڑاہی', category: 'Karahi', popular: true, prices: halfFull(1000, 1900) },
  {
    name: 'Chicken Qorma',
    nameUrdu: 'چکن قورمہ',
    category: 'Karahi',
    configurableNote: 'Category placement (Karahi) assumed — move via Admin if needed.',
    prices: halfFull(250, 350)
  },

  // Daal
  { name: 'Daal Mash', nameUrdu: 'دال ماش', category: 'Daal', prices: halfFull(150, 180) },
  { name: 'Daal Chana', nameUrdu: 'دال چنا', category: 'Daal', prices: halfFull(150, 180) },
  { name: 'Lal Lobia', nameUrdu: 'لال لوبیا', category: 'Daal', prices: halfFull(180, 220) },
  { name: 'Kadhi Pakora', nameUrdu: 'کڑی پکوڑہ', category: 'Daal', prices: halfFull(150, 180) },

  // Sabzi
  { name: 'Mix Sabzi', nameUrdu: 'مکس سبزی', category: 'Sabzi', prices: halfFull(120, 180) },
  {
    name: 'Shahi Chana',
    nameUrdu: 'شاہی چنے',
    category: 'Sabzi',
    configurableNote: 'Category placement (Sabzi) assumed.',
    prices: halfFull(150, 180)
  },
  {
    name: 'Chana Chawal',
    nameUrdu: 'چنا چاول',
    category: 'Sabzi',
    configurableNote: 'Category placement (Sabzi) assumed.',
    prices: halfFull(150, 200)
  },

  // Breads
  { name: 'Sada Paratha', nameUrdu: 'سادہ پراٹھا', category: 'Breads', prices: std(60) },
  { name: 'Chicken Paratha', nameUrdu: 'چکن پراٹھا', category: 'Breads', prices: std(180) },
  { name: 'Aloo Paratha', nameUrdu: 'آلو پراٹھا', category: 'Breads', prices: std(90) },
  { name: 'Naan', nameUrdu: 'نان', category: 'Breads', popular: true, prices: std(30) },
  { name: 'Pateeri', nameUrdu: 'پتیری', category: 'Breads', prices: std(25) },
  { name: 'Chapati', nameUrdu: 'چپاتی', category: 'Breads', prices: std(20) },
  { name: 'Raita / Salad', nameUrdu: 'رائتہ / سلاد', category: 'Breads', prices: std(50) },

  // Sides
  { name: 'Finger Chips / Fries', nameUrdu: 'فنگر چپس', category: 'Sides', prices: std(100) },

  // Beverages
  {
    name: 'Chai',
    nameUrdu: 'چائے',
    category: 'Beverages',
    popular: true,
    configurableNote: 'Menu shows "80 / 100" — modelled as Regular / Large.',
    prices: [
      { variant: 'HALF', label: 'Regular', price: 80 },
      { variant: 'FULL', label: 'Large', price: 100 }
    ]
  },
  { name: 'Special Chai', nameUrdu: 'اسپیشل چائے', category: 'Beverages', prices: std(100) },
  { name: 'Special Kehwa', nameUrdu: 'اسپیشل قہوہ', category: 'Beverages', prices: std(70) }
]

export const SEED_DEALS: SeedDeal[] = [
  {
    name: 'Deal 1',
    nameUrdu: 'ڈیل 1',
    price: 250,
    configurableNote: 'Placeholder contents/price — confirm against the photographed menu in Admin › Deals.',
    items: [
      { productName: 'Seekh Kabab', variant: 'STANDARD', quantity: 1 },
      { productName: 'Naan', variant: 'STANDARD', quantity: 2 },
      { productName: 'Raita / Salad', variant: 'STANDARD', quantity: 1 }
    ]
  },
  {
    name: 'Deal 2',
    nameUrdu: 'ڈیل 2',
    price: 1050,
    configurableNote: 'Placeholder contents/price — confirm against the photographed menu in Admin › Deals.',
    items: [
      { productName: 'Chicken Karahi', variant: 'HALF', quantity: 1 },
      { productName: 'Naan', variant: 'STANDARD', quantity: 4 },
      { productName: 'Raita / Salad', variant: 'STANDARD', quantity: 1 }
    ]
  },
  {
    name: 'Deal 3',
    nameUrdu: 'ڈیل 3',
    price: 900,
    configurableNote: 'Placeholder contents/price — confirm against the photographed menu in Admin › Deals.',
    items: [
      { productName: 'Chicken Boti', variant: 'STANDARD', quantity: 2 },
      { productName: 'Malai Boti', variant: 'STANDARD', quantity: 2 },
      { productName: 'Naan', variant: 'STANDARD', quantity: 4 },
      { productName: 'Raita / Salad', variant: 'STANDARD', quantity: 1 }
    ]
  },
  {
    name: 'HKD Special Deal',
    nameUrdu: 'ایچ کے ڈی اسپیشل ڈیل',
    price: 2400,
    configurableNote: 'Placeholder contents/price — confirm against the photographed menu in Admin › Deals.',
    items: [
      { productName: 'Makhni Karahi', variant: 'FULL', quantity: 1 },
      { productName: 'Naan', variant: 'STANDARD', quantity: 6 },
      { productName: 'Raita / Salad', variant: 'STANDARD', quantity: 2 },
      { productName: 'Chai', variant: 'HALF', quantity: 2 }
    ]
  }
]

export const SEED_PAYMENT_METHODS = [
  { code: 'CASH', label: 'Cash', requiresReference: false, allowsChange: true, sortOrder: 0 },
  { code: 'CARD', label: 'Card', requiresReference: false, allowsChange: false, sortOrder: 1 },
  { code: 'OTHER', label: 'Other', requiresReference: true, allowsChange: false, sortOrder: 2 }
]
