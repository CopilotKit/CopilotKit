import { Widget } from '@/types/widget';

export const COFFEE_ORDER_WIDGET: Widget = {
  id: 'gallery-coffee-order',
  name: 'Coffee Order',
  description: 'Coffee order summary with items and total',
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
          children: { explicitList: ['header', 'items', 'divider', 'totals', 'actions'] },
          gap: 'medium',
        },
      },
    },
    {
      id: 'header',
      component: {
        Row: {
          children: { explicitList: ['coffee-icon', 'store-name'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'coffee-icon',
      component: {
        Icon: {
          name: { literalString: 'local_cafe' },
        },
      },
    },
    {
      id: 'store-name',
      component: {
        Text: {
          text: { path: '/storeName' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'items',
      component: {
        Column: {
          children: { explicitList: ['item1', 'item2'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'item1',
      component: {
        Row: {
          children: { explicitList: ['item1-details', 'item1-price'] },
          distribution: 'spaceBetween',
          alignment: 'start',
        },
      },
    },
    {
      id: 'item1-details',
      component: {
        Column: {
          children: { explicitList: ['item1-name', 'item1-size'] },
        },
      },
    },
    {
      id: 'item1-name',
      component: {
        Text: {
          text: { path: '/item1/name' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'item1-size',
      component: {
        Text: {
          text: { path: '/item1/size' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'item1-price',
      component: {
        Text: {
          text: { path: '/item1/price' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'item2',
      component: {
        Row: {
          children: { explicitList: ['item2-details', 'item2-price'] },
          distribution: 'spaceBetween',
          alignment: 'start',
        },
      },
    },
    {
      id: 'item2-details',
      component: {
        Column: {
          children: { explicitList: ['item2-name', 'item2-size'] },
        },
      },
    },
    {
      id: 'item2-name',
      component: {
        Text: {
          text: { path: '/item2/name' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'item2-size',
      component: {
        Text: {
          text: { path: '/item2/size' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'item2-price',
      component: {
        Text: {
          text: { path: '/item2/price' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'divider',
      component: {
        Divider: {},
      },
    },
    {
      id: 'totals',
      component: {
        Column: {
          children: { explicitList: ['subtotal-row', 'tax-row', 'total-row'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'subtotal-row',
      component: {
        Row: {
          children: { explicitList: ['subtotal-label', 'subtotal-value'] },
          distribution: 'spaceBetween',
        },
      },
    },
    {
      id: 'subtotal-label',
      component: {
        Text: {
          text: { literalString: 'Subtotal' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'subtotal-value',
      component: {
        Text: {
          text: { path: '/subtotal' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'tax-row',
      component: {
        Row: {
          children: { explicitList: ['tax-label', 'tax-value'] },
          distribution: 'spaceBetween',
        },
      },
    },
    {
      id: 'tax-label',
      component: {
        Text: {
          text: { literalString: 'Tax' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'tax-value',
      component: {
        Text: {
          text: { path: '/tax' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'total-row',
      component: {
        Row: {
          children: { explicitList: ['total-label', 'total-value'] },
          distribution: 'spaceBetween',
        },
      },
    },
    {
      id: 'total-label',
      component: {
        Text: {
          text: { literalString: 'Total' },
          usageHint: 'h4',
        },
      },
    },
    {
      id: 'total-value',
      component: {
        Text: {
          text: { path: '/total' },
          usageHint: 'h4',
        },
      },
    },
    {
      id: 'actions',
      component: {
        Row: {
          children: { explicitList: ['purchase-btn', 'add-btn'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'purchase-btn-text',
      component: {
        Text: {
          text: { literalString: 'Purchase' },
        },
      },
    },
    {
      id: 'purchase-btn',
      component: {
        Button: {
          child: 'purchase-btn-text',
          action: 'purchase',
        },
      },
    },
    {
      id: 'add-btn-text',
      component: {
        Text: {
          text: { literalString: 'Add to cart' },
        },
      },
    },
    {
      id: 'add-btn',
      component: {
        Button: {
          child: 'add-btn-text',
          action: 'add_to_cart',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        storeName: 'Sunrise Coffee',
        item1: { name: 'Oat Milk Latte', size: 'Grande, Extra Shot', price: '$6.45' },
        item2: { name: 'Chocolate Croissant', size: 'Warmed', price: '$4.25' },
        subtotal: '$10.70',
        tax: '$0.96',
        total: '$11.66',
      },
    },
  ],
};

export const COFFEE_ORDER_GALLERY = { widget: COFFEE_ORDER_WIDGET, height: 380 };
