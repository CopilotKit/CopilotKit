'runtime edge'

import { ImageResponse } from '@vercel/og'

const getInter = async () => {
  const response = await fetch(
    `https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfMZg.ttf`
  )
  const res = await response.arrayBuffer()
  return res
}

const getInterSemibold = async () => {
  const response = await fetch(
    `https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuGKYMZg.ttf`
  )
  const res = await response.arrayBuffer()
  return res
}

export async function GET(req) {
  const { searchParams } = req.nextUrl;

  const params = searchParams.get('params');
  const obj = Buffer.from(params, "base64").toString("utf-8");
  const { width, height } = JSON.parse(obj);

  const title = "useCopilotAction";
  const subtitle = "CopilotKit Documentation";

  return new ImageResponse(
    (
      <section
        style={{
          backgroundColor: '#000000',
          background:
            'linear-gradient(120deg, rgba(0,0,0,1) 0%, rgba(17,41,28,1) 54%, rgba(47,119,79,0.7) 100%)',
          width: '100%',
          height: '100%',
          padding: '5%',
          display: 'block',
          position: 'relative',
          fontFamily: 'Inter',
        }}
      >
        {/* <img
          style={{
            position: 'absolute',
            opacity: 0.3,
            bottom: -90,
            right: -120,
          }}
          src="https://cdn.pezzo.ai/logo-square-transparent-bg.png"
          width="54%"
        /> */}

        <section style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex' }}>
            {/* <img
              style={{
                width: '14rem',
              }}
              src="https://cdn.pezzo.ai/logo-dark-mode.svg"
            /> */}
          </div>

          <section
            style={{
              flexGrow: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
            }}
          >
            {subtitle && (
              <p
                style={{
                  color: '#61BC89',
                  fontSize: 34,
                  marginBottom: 12,
                  fontWeight: 700,
                  fontFamily: 'Inter',
                  direction: 'rtl'
                }}
              >
                {subtitle}
              </p>
            )}
            {title && (
              <p
                style={{
                  color: 'white',
                  fontFamily: 'Inter',
                  margin: 0,
                  fontSize: 48,
                  fontWeight: 400,
                }}
              >
                {title}
              </p>
            )}
          </section>
        </section>
      </section>
    ),
    {
      width: width || 1200,
      height: height || 630,
      fonts: [
        {
          name: 'Inter',
          weight: 400,
          data: await getInter(),
          style: 'normal',
        },
        {
          name: 'Inter',
          weight: 700,
          data: await getInterSemibold(),
          style: 'normal',
        },
      ],
    }
  )
}
