import { Widget } from '@/types/widget';

export const FLIGHT_STATUS_WIDGET: Widget = {
  id: 'gallery-flight-status',
  name: 'Flight Status',
  description: 'Real-time flight tracking with route and timing information',
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
          children: { explicitList: ['header-row', 'route-row', 'divider', 'times-row'] },
          gap: 'small',
          alignment: 'stretch',
        },
      },
    },
    // Header: Flight indicator + Flight Number + Date
    {
      id: 'header-row',
      component: {
        Row: {
          children: { explicitList: ['header-left', 'date'] },
          distribution: 'spaceBetween',
          alignment: 'center',
        },
      },
    },
    {
      id: 'header-left',
      component: {
        Row: {
          children: { explicitList: ['flight-indicator', 'flight-number'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'flight-indicator',
      component: {
        Icon: {
          name: { literalString: 'flight' },
        },
      },
    },
    {
      id: 'flight-number',
      component: {
        Text: {
          text: { path: '/flightNumber' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'date',
      component: {
        Text: {
          text: { path: '/date' },
          usageHint: 'caption',
        },
      },
    },
    // Route: Origin → Destination
    {
      id: 'route-row',
      component: {
        Row: {
          children: { explicitList: ['origin', 'arrow', 'destination'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'origin',
      component: {
        Text: {
          text: { path: '/origin' },
          usageHint: 'h2',
        },
      },
    },
    {
      id: 'arrow',
      component: {
        Text: {
          text: { literalString: '→' },
          usageHint: 'h2',
        },
      },
    },
    {
      id: 'destination',
      component: {
        Text: {
          text: { path: '/destination' },
          usageHint: 'h2',
        },
      },
    },
    // Divider
    {
      id: 'divider',
      component: {
        Divider: {},
      },
    },
    // Times: Departure | Status | Arrival
    {
      id: 'times-row',
      component: {
        Row: {
          children: { explicitList: ['departure-col', 'status-col', 'arrival-col'] },
          distribution: 'spaceBetween',
        },
      },
    },
    {
      id: 'departure-col',
      component: {
        Column: {
          children: { explicitList: ['departure-label', 'departure-time'] },
          alignment: 'start',
          gap: 'none',
        },
      },
    },
    {
      id: 'departure-label',
      component: {
        Text: {
          text: { literalString: 'Departs' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'departure-time',
      component: {
        Text: {
          text: { path: '/departureTime' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'status-col',
      component: {
        Column: {
          children: { explicitList: ['status-label', 'status-value'] },
          alignment: 'center',
          gap: 'none',
        },
      },
    },
    {
      id: 'status-label',
      component: {
        Text: {
          text: { literalString: 'Status' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'status-value',
      component: {
        Text: {
          text: { path: '/status' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'arrival-col',
      component: {
        Column: {
          children: { explicitList: ['arrival-label', 'arrival-time'] },
          alignment: 'end',
          gap: 'none',
        },
      },
    },
    {
      id: 'arrival-label',
      component: {
        Text: {
          text: { literalString: 'Arrives' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'arrival-time',
      component: {
        Text: {
          text: { path: '/arrivalTime' },
          usageHint: 'h3',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'On Time',
      data: {
        flightNumber: 'OS 87',
        date: 'Mon, Dec 15',
        origin: 'Vienna',
        destination: 'New York',
        departureTime: '10:15 AM',
        status: 'On Time',
        arrivalTime: '2:30 PM',
      },
    },
    {
      name: 'Delayed',
      data: {
        flightNumber: 'OS 87',
        date: 'Mon, Dec 15',
        origin: 'Vienna',
        destination: 'New York',
        departureTime: '11:45 AM',
        status: 'Delayed',
        arrivalTime: '4:00 PM',
      },
    },
    {
      name: 'Boarding',
      data: {
        flightNumber: 'OS 87',
        date: 'Mon, Dec 15',
        origin: 'Vienna',
        destination: 'New York',
        departureTime: '10:15 AM',
        status: 'Boarding',
        arrivalTime: '2:30 PM',
      },
    },
  ],
};

export const FLIGHT_STATUS_GALLERY = {
  widget: FLIGHT_STATUS_WIDGET,
  height: 200,
};
