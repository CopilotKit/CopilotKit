import { Widget } from '@/types/widget';

export const PRODUCT_CARD_WIDGET: Widget = {
  id: 'gallery-product-card',
  name: 'Product Card',
  description: 'E-commerce product display with price and actions',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  root: 'root',
  components: [
    {
      id: 'root',
      component: {
        Card: {
          child: 'main-column',
        },
      },
    },
    {
      id: 'main-column',
      component: {
        Column: {
          children: { explicitList: ['image', 'details'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'image',
      component: {
        Image: {
          url: { path: '/imageUrl' },
          altText: { path: '/name' },
          fit: 'cover',
        },
      },
    },
    {
      id: 'details',
      component: {
        Column: {
          children: { explicitList: ['name', 'rating-row', 'price-row', 'actions'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'name',
      component: {
        Text: {
          text: { path: '/name' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'rating-row',
      component: {
        Row: {
          children: { explicitList: ['stars', 'reviews'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'stars',
      component: {
        Text: {
          text: { path: '/stars' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'reviews',
      component: {
        Text: {
          text: { path: '/reviews' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'price-row',
      component: {
        Row: {
          children: { explicitList: ['price', 'original-price'] },
          gap: 'small',
          alignment: 'baseline',
        },
      },
    },
    {
      id: 'price',
      component: {
        Text: {
          text: { path: '/price' },
          usageHint: 'h2',
        },
      },
    },
    {
      id: 'original-price',
      component: {
        Text: {
          text: { path: '/originalPrice' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'actions',
      component: {
        Row: {
          children: { explicitList: ['add-cart-btn'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'add-cart-btn-text',
      component: {
        Text: {
          text: { literalString: 'Add to Cart' },
        },
      },
    },
    {
      id: 'add-cart-btn',
      component: {
        Button: {
          child: 'add-cart-btn-text',
          action: 'addToCart',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=300&h=200&fit=crop',
        name: 'Wireless Headphones Pro',
        stars: '★★★★★',
        reviews: '(2,847 reviews)',
        price: '$199.99',
        originalPrice: '$249.99',
      },
    },
    {
      name: 'Out of Stock',
      data: {
        imageUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300&h=200&fit=crop',
        name: 'Smart Watch Series X',
        stars: '★★★★☆',
        reviews: '(1,234 reviews)',
        price: '$349.00',
        originalPrice: '',
      },
    },
  ],
};

export const PRODUCT_CARD_GALLERY = {
  widget: PRODUCT_CARD_WIDGET,
  height: 320,
};
