import { useQuery } from '@tanstack/react-query'
import { robotApi } from './robot-api'
import { useRobotStore } from '../store'
import { useEffect } from 'react'

export function useRobots() {
  const setRobots = useRobotStore(s => s.setRobots)
  const setLoading = useRobotStore(s => s.setLoading)
  const setError = useRobotStore(s => s.setError)

  const query = useQuery({
    queryKey: ['robots'],
    queryFn: robotApi.list,
    staleTime: 30_000,
  })

  useEffect(() => {
    setLoading(query.isLoading)
    if (query.data) setRobots(query.data)
    if (query.error) setError(query.error.message)
  }, [query.data, query.error, query.isLoading, setRobots, setLoading, setError])

  return query
}

export function useRobot(id: string) {
  return useQuery({
    queryKey: ['robots', id],
    queryFn: () => robotApi.get(id),
    enabled: !!id,
  })
}
