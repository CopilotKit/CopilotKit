/** @type {import('tailwindcss').Config} */
import headlessuiPlugin from '@headlessui/tailwindcss';

export default {
    darkMode: ['class'],
    content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
  	backgroundImage: {
  		DEFAULT: 'url(/bg.svg)'
  	},
  	boxShadow: {
  		sm: '2px 4px 9px 0px rgba(166, 141, 174, 0.28)',
  		md: '4px 5px 9px 0px rgba(166, 141, 174, 0.28)'
  	},
  	borderRadius: {
  		sm: '4px',
  		md: '8px',
  		lg: '10px',
  		xl: '12px',
  		full: '9999px'
  	},
  	colors: {
  		current: 'currentColor',
  		inherit: 'inherit',
  		transparent: 'transparent',
  		black: '#000',
  		white: '#FFF',
  		accent: {
  			DEFAULT: '#7B61FF',
  			hover: '#6243FF'
  		},
  		error: '#FF2B77',
  		high: '#FF2B77',
  		medium: '#E2A300',
  		low: '#6BD475',
  		neutral: {
  			DEFAULT: '#3F3F3F',
  			light: '#888'
  		},
  		divider: '#ACA7C3',
  		disabled: '#ACA7C3'
  	},
  	container: {
  		center: 'true',
  		padding: {
  			DEFAULT: '24px',
  			md: '40px',
  			xl: '0'
  		}
  	},
  	fontFamily: {
  		primary: ['Poppins', 'sans-serif'],
  		secondary: ['Alata', 'sans-serif']
  	},
  	fontSize: {
  		xs: ['12px', { lineHeight: '16px' }],
  		sm: ['14px', { lineHeight: '20px' }],
  		base: ['16px', { lineHeight: '1.5' }],
  		lg: ['24px', { lineHeight: 'normal' }],
  		xl: ['32px', { lineHeight: 'normal' }]
  	},
  	screens: {
  		sm: '640px',
  		md: '768px',
  		lg: '1024px',
  		xl: '1280px'
  	},
  	spacing: {
  		'0': '0',
  		'1': '4px',
  		'2': '8px',
  		'3': '12px',
  		'4': '16px',
  		'5': '20px',
  		'6': '24px',
  		'7': '28px',
  		'8': '32px',
  		'9': '36px',
  		'10': '40px',
  		'11': '44px',
  		'12': '48px',
  		'14': '56px',
  		'15': '60px',
  		'16': '64px',
  		'18': '72px',
  		'20': '80px',
  		px: '1px',
  		'0.5': '2px',
  		'1.5': '6px',
  		'2.5': '10px',
  		'3.5': '14px'
  	},
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		}
  	}
  },
  plugins: [headlessuiPlugin, require("tailwindcss-animate")],
};
