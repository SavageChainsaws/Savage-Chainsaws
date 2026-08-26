'use client'

import { createClient } from '@supabase/supabase-js'

import { Suspense } from 'react'
import Link from 'next/link'
import InactivityRedirect from './components/InactivityRedirect'
import AdminGate from './components/AdminGate'
import LastViewedBanner from './components/LastViewedBanner'
import AdminLogout from './components/AdminLogout'
import DeleteUnitButton from './components/DeleteUnitButton'
import CheckInForm from './components/CheckInForm'
import AppNav from './components/AppNav'
import ForceLogout from './components/ForceLogout'