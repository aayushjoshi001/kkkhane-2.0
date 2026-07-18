// Royal Rest House — full menu, transcribed from the printed menu photos.
// Each item: { name, price, desc?, tags?, img, variations?: [{name, price}] }
// `img` is a search query used to fetch a free-licensed dish photo (Wikimedia Commons).
// For variation items, base `price` = min(variation prices); the app shows a range.

export const RESTAURANT_ID = '0ac00f51-94b0-4964-aeea-f494cfb4f7e0'

/** Categories in display order. Each has an item list. */
export const MENU = [
  {
    category: 'Momo',
    img: 'momo dumpling nepali',
    items: [
      { name: 'Steam Momo', price: 120, img: 'steamed momo dumplings', tags: ['momo'] },
      { name: 'Jhol Momo', price: 180, img: 'jhol momo soup', tags: ['momo'] },
      { name: 'Chili Momo', price: 180, img: 'chilli momo fried', tags: ['momo', 'spicy'],
        variations: [ { name: 'Veg', price: 180 }, { name: 'Buff', price: 280 }, { name: 'Chicken', price: 300 } ] },
      { name: 'Fried Momo', price: 150, img: 'fried momo kothey', tags: ['momo'],
        variations: [ { name: 'Veg', price: 150 }, { name: 'Buff', price: 190 }, { name: 'Chicken', price: 200 } ] },
      { name: 'Sadeko Momo', price: 180, img: 'sadeko momo', tags: ['momo'],
        variations: [ { name: 'Veg', price: 180 }, { name: 'Buff', price: 230 }, { name: 'Chicken', price: 250 } ] },
    ],
  },
  {
    category: 'Chowmein',
    img: 'chow mein noodles',
    items: [
      { name: 'Chowmein', price: 120, img: 'chow mein fried noodles', tags: ['noodles'],
        variations: [ { name: 'Veg', price: 120 }, { name: 'Egg', price: 160 }, { name: 'Buff', price: 180 }, { name: 'Chicken', price: 200 }, { name: 'Mixed', price: 250 } ] },
    ],
  },
  {
    category: 'Thukpa',
    img: 'thukpa noodle soup',
    items: [
      { name: 'Thukpa', price: 150, img: 'thukpa tibetan noodle soup', tags: ['noodles', 'soup'],
        variations: [ { name: 'Veg', price: 150 }, { name: 'Egg', price: 180 }, { name: 'Buff', price: 190 }, { name: 'Chicken', price: 200 }, { name: 'Mixed', price: 250 } ] },
    ],
  },
  {
    category: 'Fried Rice',
    img: 'fried rice',
    items: [
      { name: 'Fried Rice', price: 150, img: 'vegetable fried rice', tags: ['rice'],
        variations: [ { name: 'Veg', price: 150 }, { name: 'Egg', price: 160 }, { name: 'Buff', price: 180 }, { name: 'Chicken', price: 200 }, { name: 'Mixed', price: 250 } ] },
    ],
  },
  {
    category: 'Nepali Khana Set',
    img: 'dal bhat nepali thali',
    items: [
      { name: 'Nepali Khana Set', price: 200, img: 'nepali dal bhat thali set', tags: ['thali', 'set'],
        desc: 'Traditional Nepali dal-bhat set with rice, lentils, curry and sides.',
        variations: [ { name: 'Veg', price: 200 }, { name: 'Egg', price: 280 }, { name: 'Chicken', price: 300 }, { name: 'Paneer', price: 330 }, { name: 'Fish', price: 350 }, { name: 'Mutton', price: 380 } ] },
    ],
  },
  {
    category: 'Khaja Set',
    img: 'nepali khaja set snack',
    items: [
      { name: 'Khaja Set', price: 300, img: 'nepali khaja set beaten rice', tags: ['set', 'snack'],
        desc: 'Chiura (beaten rice) based snack platter with fry/gravy.',
        variations: [ { name: 'Buff (Fry/Gravy)', price: 300 }, { name: 'Chicken', price: 350 }, { name: 'Mutton', price: 380 } ] },
    ],
  },
  {
    category: 'Pokora',
    img: 'pakora fritters',
    items: [
      { name: 'Pokora', price: 120, img: 'pakora fritters indian', tags: ['fried'],
        variations: [ { name: 'Potato', price: 120 }, { name: 'Veg', price: 150 }, { name: 'Onion', price: 180 }, { name: 'Egg', price: 200 }, { name: 'Paneer', price: 250 }, { name: 'Chicken', price: 300 } ] },
    ],
  },
  {
    category: 'Sandeko',
    img: 'sadeko spicy salad nepali',
    items: [
      { name: 'Meat Sandeko', price: 300, img: 'chicken sadeko', tags: ['spicy', 'salad'],
        variations: [ { name: 'Buff', price: 300 }, { name: 'Chicken', price: 350 }, { name: 'Mutton', price: 380 } ] },
      { name: 'Batmass Sandeko', price: 100, img: 'bhatmas sadeko soybean', tags: ['spicy', 'salad'] },
      { name: 'Peanut Sandeko', price: 100, img: 'peanut sadeko salad', tags: ['spicy', 'salad'] },
      { name: 'Alu Sandeko', price: 100, img: 'aloo sadeko potato salad', tags: ['spicy', 'salad'] },
      { name: 'Chatpat', price: 100, img: 'chatpate nepali street snack', tags: ['spicy', 'snack'] },
      { name: 'Wai Wai Sandeko', price: 100, img: 'wai wai sadeko noodle salad', tags: ['spicy', 'snack'] },
    ],
  },
  {
    category: 'Snacks (Veg)',
    img: 'vegetarian snacks',
    items: [
      { name: 'Potato Chilly', price: 200, img: 'chilli potato', tags: ['veg', 'spicy'] },
      { name: 'French Fry', price: 150, img: 'french fries', tags: ['veg'] },
      { name: 'Paneer Chilly', price: 300, img: 'chilli paneer', tags: ['veg', 'spicy'] },
      { name: 'Jeera Alu', price: 120, img: 'jeera aloo cumin potato', tags: ['veg'] },
    ],
  },
  {
    category: 'Chicken / Mutton / Buff',
    img: 'grilled meat platter',
    items: [
      { name: 'Fry', price: 280, img: 'fried chicken pieces dry', tags: ['non-veg'],
        variations: [ { name: 'Buff', price: 280 }, { name: 'Chicken', price: 300 }, { name: 'Mutton', price: 350 } ] },
      { name: 'Sadeko', price: 300, img: 'chicken sadeko spicy', tags: ['non-veg', 'spicy'],
        variations: [ { name: 'Buff', price: 300 }, { name: 'Chicken', price: 320 }, { name: 'Mutton', price: 380 } ] },
      { name: 'Chilly', price: 330, img: 'chilli chicken dry', tags: ['non-veg', 'spicy'],
        variations: [ { name: 'Buff', price: 330 }, { name: 'Chicken', price: 350 }, { name: 'Mutton', price: 400 } ] },
      { name: 'Chicken Roast', price: 300, img: 'roasted chicken', tags: ['non-veg'] },
      { name: 'Tass', price: 300, img: 'tas meat fried nepali', tags: ['non-veg'],
        variations: [ { name: 'Buff', price: 300 }, { name: 'Chicken', price: 300 }, { name: 'Mutton', price: 350 } ] },
      { name: 'Choila', price: 300, img: 'choila newari buff', tags: ['non-veg', 'spicy'],
        variations: [ { name: 'Buff', price: 300 }, { name: 'Chicken', price: 350 }, { name: 'Mutton', price: 380 } ] },
      { name: 'Sekuwa', price: 300, img: 'sekuwa grilled skewer meat', tags: ['non-veg', 'grilled'],
        variations: [ { name: 'Buff', price: 300 }, { name: 'Chicken', price: 350 }, { name: 'Mutton', price: 380 } ] },
      { name: 'Buff Sukuti', price: 300, img: 'sukuti dried meat', tags: ['non-veg'] },
      { name: 'Chicken Lolipop', price: 350, desc: '6 pcs.', img: 'chicken lollipop', tags: ['non-veg'] },
      { name: 'Chicken Legpiece', price: 250, desc: '1 pc.', img: 'fried chicken leg', tags: ['non-veg'] },
    ],
  },
  {
    category: 'Curry',
    img: 'curry gravy indian',
    items: [
      { name: 'Paneer Butter Masala', price: 300, img: 'paneer butter masala', tags: ['veg', 'curry'] },
      { name: 'Chicken Butter Masala', price: 350, img: 'butter chicken masala', tags: ['non-veg', 'curry'] },
      { name: 'Mutton Butter Masala', price: 380, img: 'mutton butter masala curry', tags: ['non-veg', 'curry'] },
      { name: 'Fish Curry', price: 300, img: 'fish curry', tags: ['non-veg', 'curry'] },
      { name: 'Chicken Curry', price: 300, img: 'chicken curry gravy', tags: ['non-veg', 'curry'] },
      { name: 'Mutton Curry', price: 350, img: 'mutton curry', tags: ['non-veg', 'curry'] },
      { name: 'Mix Veg', price: 250, img: 'mixed vegetable curry', tags: ['veg', 'curry'] },
      { name: 'Dal Fry', price: 150, img: 'dal fry lentil', tags: ['veg', 'curry'] },
      { name: 'Mutter Paneer', price: 300, img: 'matar paneer', tags: ['veg', 'curry'] },
      { name: 'Egg Curry', price: 250, img: 'egg curry', tags: ['non-veg', 'curry'] },
    ],
  },
  {
    category: 'Pizza',
    img: 'pizza',
    items: [
      { name: 'Pizza (Small)', price: 400, img: 'pizza cheese', tags: [],
        variations: [ { name: 'Cheese', price: 400 }, { name: 'Chicken', price: 500 } ] },
    ],
  },
  {
    category: 'Sandwich',
    img: 'sandwich',
    items: [
      { name: 'Sandwich', price: 150, img: 'grilled sandwich', tags: [],
        variations: [ { name: 'Veg', price: 150 }, { name: 'Buff', price: 200 }, { name: 'Chicken', price: 200 }, { name: 'Cheese', price: 220 } ] },
    ],
  },
  {
    category: 'Burger',
    img: 'burger',
    items: [
      { name: 'Burger', price: 200, img: 'hamburger', tags: [],
        variations: [ { name: 'Veg', price: 200 }, { name: 'Buff', price: 230 }, { name: 'Chicken', price: 250 } ] },
    ],
  },
  {
    category: 'Paratha',
    img: 'paratha flatbread',
    items: [
      { name: 'Paratha', price: 50, img: 'aloo paratha', tags: [],
        variations: [ { name: 'Plain', price: 50 }, { name: 'Alu', price: 70 }, { name: 'Egg', price: 100 }, { name: 'Chicken', price: 120 }, { name: 'Paneer', price: 150 } ] },
    ],
  },
  {
    category: 'Breakfast',
    img: 'breakfast',
    items: [
      { name: 'Puri Sabji', price: 150, img: 'puri bhaji', tags: [] },
      { name: 'Chana Egg', price: 150, img: 'chana masala egg', tags: [] },
      { name: 'Omlet Toast', price: 130, img: 'omelette toast', tags: [] },
      { name: 'Bread Omlet', price: 130, img: 'bread omelette', tags: [] },
      { name: 'French Toast', price: 200, img: 'french toast', tags: [] },
      { name: 'Bread Jam', price: 80, img: 'bread with jam', tags: [] },
    ],
  },
  {
    category: 'Sausage',
    img: 'sausage',
    items: [
      { name: 'Chicken Sausage', price: 70, desc: 'per piece (Fry/Boil)', img: 'chicken sausage fried', tags: ['non-veg'] },
      { name: 'Buff Sausage', price: 60, desc: 'per piece (Fry/Boil)', img: 'sausage grilled', tags: ['non-veg'] },
    ],
  },
  {
    category: 'Tandoor',
    img: 'naan tandoor bread',
    items: [
      { name: 'Tandoor Bread', price: 30, img: 'butter naan tandoor', tags: ['bread'],
        variations: [ { name: 'Tandoori Roti', price: 30 }, { name: 'Plain Naan', price: 60 }, { name: 'Butter Naan', price: 70 } ] },
    ],
  },
  {
    category: 'Hot Beverage',
    img: 'hot tea coffee',
    items: [
      { name: 'Coffee', price: 50, img: 'coffee cup', tags: ['beverage'],
        variations: [ { name: 'Black', price: 50 }, { name: 'Milk', price: 70 } ] },
      { name: 'Tea', price: 25, img: 'milk tea chiya', tags: ['beverage'],
        variations: [ { name: 'Black', price: 25 }, { name: 'Milk', price: 30 }, { name: 'Lemon', price: 30 } ] },
    ],
  },
  {
    category: 'Lassi',
    img: 'lassi yogurt drink',
    items: [
      { name: 'Lassi', price: 100, img: 'lassi glass', tags: ['beverage'],
        variations: [ { name: 'Plain', price: 100 }, { name: 'Banana', price: 150 } ] },
    ],
  },
  {
    category: 'Cold Drinks',
    img: 'soft drink bottles',
    items: [
      { name: 'Coke', price: 0, img: 'coca cola bottle', tags: ['beverage'] },
      { name: 'Sprite', price: 0, img: 'sprite bottle', tags: ['beverage'] },
      { name: 'Fanta', price: 0, img: 'fanta orange bottle', tags: ['beverage'] },
      { name: 'Dew', price: 0, img: 'mountain dew bottle', tags: ['beverage'] },
      { name: 'Slice', price: 0, img: 'mango juice drink', tags: ['beverage'] },
    ],
  },
  {
    category: 'Hard Drinks',
    img: 'whisky bottle',
    items: [
      { name: 'Golden Oak', price: 0, img: 'whisky bottle', tags: ['alcohol'] },
      { name: 'Blue Diamond', price: 0, img: 'whisky glass', tags: ['alcohol'] },
      { name: 'OD Regular', price: 0, img: 'whiskey bottle', tags: ['alcohol'] },
      { name: 'OD Black Chimney', price: 0, img: 'whiskey glass', tags: ['alcohol'] },
      { name: '8848', price: 0, img: 'whisky bottle dark', tags: ['alcohol'] },
      { name: 'Signature (G/R)', price: 0, img: 'whiskey drink', tags: ['alcohol'] },
      { name: 'XXX Rum', price: 0, img: 'rum bottle', tags: ['alcohol'] },
    ],
  },
  {
    category: 'Beer',
    img: 'beer bottle',
    items: [
      { name: 'Tuborg', price: 0, img: 'beer bottle green', tags: ['alcohol', 'beer'] },
      { name: 'Gorkha', price: 0, img: 'beer glass', tags: ['alcohol', 'beer'] },
      { name: 'Barahsingha', price: 0, img: 'beer bottle', tags: ['alcohol', 'beer'] },
    ],
  },
]
