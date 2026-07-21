import { Link, isRouteErrorResponse, useRouteError } from 'react-router'

function ErrorPage() {
  const error = useRouteError()

  let title = 'Something went wrong'
  let message = 'An unexpected error occurred.'

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`
    message =
      typeof error.data === 'string' ? error.data : message
  } else if (error instanceof Error) {
    message = error.message
  }

  return (
    <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: 24 }}>
        <div className="panel-title" style={{ marginBottom: 8 }}>
          {title}
        </div>
        <p className="empty-hint" style={{ height: 'auto' }}>
          {message}
        </p>
        <Link to="/" className="btn-primary" style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none' }}>
          Back home
        </Link>
      </div>
    </div>
  )
}

export default ErrorPage
