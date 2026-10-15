import CollabClient from './collab-client'

export default async function CollabPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <CollabClient token={token} />
}
