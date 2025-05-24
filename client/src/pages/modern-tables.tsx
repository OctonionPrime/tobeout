{/* Beautiful Schedule Grid */}
        <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 rounded-3xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
          <div className="p-6 border-b border-gray-200/50 dark:border-gray-700/50">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  Restaurant Management - {format(new Date(selectedDate), 'EEEE, MMMM d, yyyy')}
                </h3>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                  {activeView === 'schedule' && 'Real-time availability across all tables • Auto-refreshes every 30 seconds'}
                  {activeView === 'floorplan' && 'Drag and drop tables to arrange your restaurant layout'}
                  {activeView === 'grid' && 'Grid view of all tables with current status'}
                  {activeView === 'list' && 'Detailed list view of all table information'}
                </p>
              </div>
              <div className="flex items-center gap-4">
                {/* View Tabs */}
                <div className="flex items-center bg-white dark:bg-gray-800 rounded-xl p-1 shadow-lg border border-gray-200/50 dark:border-gray-700/50">
                  {[
                    { id: 'schedule', label: 'Schedule', icon: Clock },
                    { id: 'floorplan', label: 'Floor Plan', icon: Settings },
                    { id: 'grid', label: 'Grid', icon: MousePointer2 },
                    { id: 'list', label: 'List', icon: Edit2 }
                  ].map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => setActiveView(id as any)}
                      className={`
                        flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                        ${activeView === id 
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25' 
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-700'
                        }
                      `}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>

                {(isLoading || tablesLoading) && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                )}

                {activeView === 'schedule' && (
                  <Badge variant="outline" className="text-xs">
                    Hourly slots
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Conditional Content Based on Active View */}
          <div className="p-6">
            {activeView === 'schedule' ? (
              /* Schedule View - Existing Implementation */
              <div className="overflow-x-auto">
                <div className="min-w-[800px]">
                  {/* Compact Sticky Header */}
                  <div className="sticky top-0 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-750 border-b border-gray-200/50 dark:border-gray-700/50 px-4 py-2 z-10 rounded-lg mb-4">
                    <div className="flex">
                      <div className="w-20 flex-shrink-0 font-semibold text-gray-700 dark:text-gray-300 text-xs py-2">TIME</div>
                      <div className="flex overflow-x-auto gap-1 flex-1">
                        {scheduleData?.[0]?.tables?.map((table: TableData) => (
                          <div key={table.id} className="w-24 flex-shrink-0 text-center bg-white/50 dark:bg-gray-700/50 rounded-lg p-1.5 border border-gray-200/50 dark:border-gray-600/50">
                            <div className="font-semibold text-gray-900 dark:text-white text-xs">{table.name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {table.minGuests}-{table.maxGuests}p
                            </div>
                            {table.features && table.features.length > 0 && (
                              <div className="text-xs text-blue-600 dark:text-blue-400 truncate">
                                {table.features[0]}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Schedule Rows */}
                  <div className="divide-y divide-gray-200/30 dark:divide-gray-700/30">
                    {isLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="flex items-center gap-3">
                          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
                          <span className="text-lg">Loading schedule...</span>
                        </div>
                      </div>
                    ) : scheduleData && scheduleData.length > 0 ? (
                      scheduleData.map((slot: ScheduleSlot, rowIndex: number) => (
                        <div key={slot.time} className={`px-4 py-1.5 transition-all duration-200 hover:bg-gradient-to-r hover:from-blue-50/30 hover:to-purple-50/30 dark:hover:from-blue-900/10 dark:hover:to-purple-900/10 ${rowIndex % 2 === 0 ? 'bg-gray-50/30 dark:bg-gray-800/30' : 'bg-white dark:bg-gray-900'}`}>
                          <div className="flex items-center">
                            <div className="w-20 flex-shrink-0 font-medium text-gray-900 dark:text-white text-xs">
                              {format(new Date(`2000-01-01T${slot.time}`), 'h:mm a')}
                            </div>
                            <div className="flex gap-1 overflow-x-auto flex-1">
                              {slot.tables?.map((table: TableData) => {
                                const hasReservation = table.reservation;
                                return (
                                  <ContextMenu key={table.id}>
                                    <ContextMenuTrigger>
                                      <div
                                        className={`
                                          w-24 flex-shrink-0 relative cursor-pointer rounded-lg p-1.5 text-center text-xs font-medium transition-all duration-300 hover:scale-105 hover:shadow-lg group
                                          ${getStatusStyle(table.status, !!hasReservation)}
                                        `}
                                        draggable={true}
                                        onDragStart={(e) => handleDragStart(e, table, slot.time)}
                                        onDragEnd={handleDragEnd}
                                        onDragOver={handleDragOver}
                                        onDrop={(e) => handleDrop(e, table, slot.time)}
                                      >
                                        {hasReservation ? (
                                          <div>
                                            <div className="font-semibold text-xs">📅</div>
                                            <div className="text-xs opacity-90 truncate">
                                              {table.reservation.guestName}
                                            </div>
                                            <div className="text-xs opacity-75">
                                              {table.reservation.guestCount}p
                                            </div>
                                          </div>
                                        ) : (
                                          <div>
                                            <div className="font-semibold text-xs">
                                              {table.status === 'maintenance' ? '🔧' : 
                                               table.status === 'unavailable' ? '🚫' : '✓'}
                                            </div>
                                            <div className="text-xs opacity-90 capitalize">
                                              {table.status === 'available' ? 'Free' : table.status}
                                            </div>
                                          </div>
                                        )}

                                        {/* Hover indicator */}
                                        <div className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <MoreVertical className="h-3 w-3" />
                                        </div>
                                      </div>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent className="rounded-xl shadow-2xl border-0 bg-white dark:bg-gray-800 p-2 min-w-48">
                                      <div className="px-2 py-1 text-xs font-medium text-muted-foreground border-b mb-1">
                                        {table.name} at {format(new Date(`2000-01-01T${slot.time}`), 'h:mm a')}
                                      </div>

                                      {hasReservation ? (
                                        <>
                                          <ContextMenuItem 
                                            onClick={() => handleContextAction('cancel', table, slot.time)}
                                            className="rounded-lg hover:bg-gradient-to-r hover:from-red-50 hover:to-pink-50 dark:hover:from-red-900/20 dark:hover:to-pink-900/20 text-red-600 dark:text-red-400"
                                          >
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            Cancel Reservation
                                          </ContextMenuItem>
                                          <ContextMenuSeparator />
                                        </>
                                      ) : (
                                        <ContextMenuItem 
                                          onClick={() => handleContextAction('reserve', table, slot.time)}
                                          className="rounded-lg hover:bg-gradient-to-r hover:from-green-50 hover:to-emerald-50 dark:hover:from-green-900/20 dark:hover:to-emerald-900/20"
                                        >
                                          <Plus className="h-4 w-4 mr-2" />
                                          Create Reservation
                                        </ContextMenuItem>
                                      )}

                                      <ContextMenuItem 
                                        onClick={() => handleContextAction('available', table, slot.time)}
                                        className="rounded-lg hover:bg-gradient-to-r hover:from-blue-50 hover:to-cyan-50 dark:hover:from-blue-900/20 dark:hover:to-cyan-900/20"
                                      >
                                        <CheckCircle className="h-4 w-4 mr-2" />
                                        Make Available
                                      </ContextMenuItem>

                                      <ContextMenuItem 
                                        onClick={() => handleContextAction('block', table, slot.time)}
                                        className="rounded-lg hover:bg-gradient-to-r hover:from-red-50 hover:to-pink-50 dark:hover:from-red-900/20 dark:hover:to-pink-900/20"
                                      >
                                        <AlertCircle className="h-4 w-4 mr-2" />
                                        Block Table
                                      </ContextMenuItem>

                                      <ContextMenuItem 
                                        onClick={() => handleContextAction('maintenance', table, slot.time)}
                                        className="rounded-lg hover:bg-gradient-to-r hover:from-amber-50 hover:to-yellow-50 dark:hover:from-amber-900/20 dark:hover:to-yellow-900/20"
                                      >
                                        <Settings className="h-4 w-4 mr-2" />
                                        Set Maintenance
                                      </ContextMenuItem>

                                      <ContextMenuSeparator />

                                      <ContextMenuItem 
                                        onClick={() => handleContextAction('edit', table, slot.time)}
                                        className="rounded-lg hover:bg-gradient-to-r hover:from-gray-50 hover:to-gray-100 dark:hover:from-gray-800 dark:hover:to-gray-700"
                                      >
                                        <Edit2 className="h-4 w-4 mr-2" />
                                        Edit Table
                                      </ContextMenuItem>
                                    </ContextMenuContent>
                                  </ContextMenu>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center justify-center py-12">
                        <div className="text-center">
                          <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                            No Schedule Data Available
                          </h3>
                          <p className="text-gray-500 dark:text-gray-400 mb-4">
                            Unable to load table availability for this date.
                          </p>
                          <Button onClick={() => refetch()} variant="outline">
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Try Again
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : activeView === 'floorplan' ? (
              /* Floor Plan View - Restaurant Layout */
              <div className="relative bg-gray-50 dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg min-h-[600px] overflow-hidden">
                {/* Floor Plan Header */}
                <div className="absolute top-4 left-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border p-3 z-10">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Restaurant Floor Plan</h3>
                  <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                    <div>• Drag tables to arrange layout</div>
                    <div>• Click tables to edit details</div>
                    <div>• Right-click for quick actions</div>
                  </div>
                </div>

                {/* Status Legend */}
                <div className="absolute top-4 right-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border p-3 z-10">
                  <h4 className="text-xs font-medium text-gray-900 dark:text-white mb-2">Status Legend</h4>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-green-500 rounded"></div>
                      <span className="text-xs text-gray-600 dark:text-gray-300">Available</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-red-500 rounded"></div>
                      <span className="text-xs text-gray-600 dark:text-gray-300">Occupied</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-amber-500 rounded"></div>
                      <span className="text-xs text-gray-600 dark:text-gray-300">Reserved</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-gray-400 rounded"></div>
                      <span className="text-xs text-gray-600 dark:text-gray-300">Unavailable</span>
                    </div>
                  </div>
                </div>

                {/* Floor Plan Content */}
                <div 
                  className="pt-32 px-8 pb-8 h-full"
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e)}
                >
                  {tablesLoading ? (
                    <div className="flex items-center justify-center h-64">
                      <div className="text-center">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-900 border-t-transparent mx-auto mb-4"></div>
                        <p className="text-gray-500">Loading floor plan...</p>
                      </div>
                    </div>
                  ) : allTables && allTables.length > 0 ? (
                    <div className="relative grid grid-cols-8 gap-4 min-h-[400px]">
                      {allTables.map((table: any, index: number) => {
                        const statusColors = {
                          free: 'bg-green-500',
                          occupied: 'bg-red-500',
                          reserved: 'bg-amber-500',
                          unavailable: 'bg-gray-400'
                        };
                        const statusColor = statusColors[table.status as keyof typeof statusColors] || statusColors.free;

                        return (
                          <ContextMenu key={table.id}>
                            <ContextMenuTrigger>
                              <div
                                className={`relative cursor-move group transform transition-all duration-200 hover:scale-105 ${
                                  index % 8 < 4 ? 'col-start-' + (index % 4 + 1) : 'col-start-' + (index % 4 + 5)
                                } ${Math.floor(index / 4) % 2 === 0 ? 'row-start-1' : 'row-start-3'}`}
                                draggable
                                onDragStart={(e) => handleDragStart(e, table)}
                                onDragEnd={handleDragEnd}
                                onClick={() => handleContextAction('edit', table, '')}
                              >
                                {/* Table Shape */}
                                <div className={`w-16 h-16 ${statusColor} rounded-lg shadow-lg flex items-center justify-center text-white font-bold text-sm border-2 border-white`}>
                                  {table.name}
                                </div>

                                {/* Table Info Tooltip */}
                                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                  <div className="bg-gray-900 text-white text-xs rounded-lg py-2 px-3 whitespace-nowrap">
                                    <div className="font-medium">{table.name}</div>
                                    <div>{table.minGuests}-{table.maxGuests} guests</div>
                                    <div className="capitalize">{table.status || 'free'}</div>
                                    {table.features && table.features.length > 0 && (
                                      <div className="text-gray-300 mt-1">
                                        {table.features.slice(0, 2).join(', ')}
                                        {table.features.length > 2 && '...'}
                                      </div>
                                    )}
                                  </div>
                                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                                </div>

                                {/* Capacity Indicator */}
                                <div className="absolute -top-1 -right-1 bg-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-medium text-gray-700 shadow-sm border">
                                  {table.maxGuests}
                                </div>

                                {/* Features Indicator */}
                                {table.features && table.features.length > 0 && (
                                  <div className="absolute -bottom-1 -right-1 bg-blue-500 rounded-full w-4 h-4 flex items-center justify-center text-xs font-medium text-white shadow-sm">
                                    {table.features.length}
                                  </div>
                                )}
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="rounded-xl shadow-2xl border-0 bg-white dark:bg-gray-800 p-2 min-w-48">
                              <div className="px-2 py-1 text-xs font-medium text-muted-foreground border-b mb-1">
                                {table.name} - Floor Plan Actions
                              </div>

                              <ContextMenuItem 
                                onClick={() => handleContextAction('edit', table, '')}
                                className="rounded-lg hover:bg-gradient-to-r hover:from-blue-50 hover:to-cyan-50 dark:hover:from-blue-900/20 dark:hover:to-cyan-900/20"
                              >
                                <Edit2 className="h-4 w-4 mr-2" />
                                Edit Table Details
                              </ContextMenuItem>

                              <ContextMenuItem 
                                onClick={() => handleContextAction('available', table, '')}
                                className="rounded-lg hover:bg-gradient-to-r hover:from-green-50 hover:to-emerald-50 dark:hover:from-green-900/20 dark:hover:to-emerald-900/20"
                              >
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Mark Available
                              </ContextMenuItem>

                              <ContextMenuItem 
                                onClick={() => handleContextAction('maintenance', table, '')}
                                className="rounded-lg hover:bg-gradient-to-r hover:from-amber-50 hover:to-yellow-50 dark:hover:from-amber-900/20 dark:hover:to-yellow-900/20"
                              >
                                <Settings className="h-4 w-4 mr-2" />
                                Set Maintenance Mode
                              </ContextMenuItem>

                              <ContextMenuSeparator />

                              <ContextMenuItem 
                                onClick={() => {
                                  // Delete table functionality
                                  toast({
                                    title: "Table Removal",
                                    description: `${table.name} marked for removal (would require confirmation)`,
                                    variant: "destructive"
                                  });
                                }}
                                className="rounded-lg hover:bg-gradient-to-r hover:from-red-50 hover:to-pink-50 dark:hover:from-red-900/20 dark:hover:to-pink-900/20 text-red-600 dark:text-red-400"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Remove Table
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-64">
                      <div className="text-center">
                        <div className="w-16 h-16 bg-gray-200 rounded-lg mx-auto mb-4 flex items-center justify-center">
                          <Plus className="h-8 w-8 text-gray-400" />
                        </div>
                        <p className="text-gray-500 mb-4">No tables in your floor plan yet</p>
                        <Button onClick={() => setShowAddTableModal(true)}>
                          <Plus className="mr-2 h-4 w-4" />
                          Add Your First Table
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : activeView === 'grid' ? (
              /* Grid View */
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
                {availabilityLoading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="aspect-square animate-pulse bg-gray-100 rounded-lg"></div>
                  ))
                ) : timeSpecificTables && timeSpecificTables.length > 0 ? (
                  timeSpecificTables.map((table: any) => {
                    const statusClass = getTableStatusColor(table.status);
                    return (
                      <div 
                        key={table.id} 
                        className={`aspect-square ${statusClass} rounded-lg flex flex-col items-center justify-center p-2 border relative group cursor-pointer transition-all duration-200 hover:scale-105`}
                        onClick={() => handleContextAction('edit', table, selectedTime)}
                      >
                        <span className="text-sm font-semibold">{table.name}</span>
                        <div className="flex items-center justify-center mt-1">
                          <span className="text-xs">{table.minGuests}-{table.maxGuests} guests</span>
                        </div>
                        <span className="text-xs mt-1 capitalize">{table.status || 'free'}</span>

                        {/* Reservation info if exists */}
                        {table.reservation && (
                          <div className="mt-2 text-center">
                            <div className="text-xs font-medium">{table.reservation.guestName}</div>
                            <div className="text-xs opacity-75">{table.reservation.guestCount}p</div>
                          </div>
                        )}

                        {/* Features badges */}
                        {table.features && table.features.length > 0 && (
                          <div className="mt-2 flex flex-wrap justify-center gap-1">
                            {table.features.slice(0, 2).map((feature: string, index: number) => (
                              <Badge key={index} variant="outline" className="text-[10px] py-0 px-1">
                                {feature}
                              </Badge>
                            ))}
                            {table.features.length > 2 && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1">
                                +{table.features.length - 2}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="col-span-full py-8 text-center text-gray-500">
                    <p>No tables available for the selected time</p>
                    <Button variant="outline" onClick={() => setShowAddTableModal(true)} className="mt-2">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Tables
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              /* List View */
              <div className="rounded-md border">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Capacity</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Reservation</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Features</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                      {availabilityLoading ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-4 text-center">
                            <div className="flex justify-center">
                              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-900 border-t-transparent"></div>
                            </div>
                          </td>
                        </tr>
                      ) : timeSpecificTables && timeSpecificTables.length > 0 ? (
                        timeSpecificTables.map((table: any) => (
                          <tr key={table.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                              {table.name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                              {table.minGuests} - {table.maxGuests} guests
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <Badge 
                                className={`capitalize ${
                                  table.status === 'free' || table.status === 'available' ? 'bg-green-100 text-green-800' :
                                  table.status === 'occupied' ? 'bg-red-100 text-red-800' : 
                                  table.status === 'reserved' ? 'bg-amber-100 text-amber-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}
                              >
                                {table.status || 'free'}
                              </Badge>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                              {table.reservation ? (
                                <div>
                                  <div className="font-medium">{table.reservation.guestName}</div>
                                  <div className="text-xs">{table.reservation.guestCount} guests</div>
                                </div>
                              ) : (
                                <span className="text-gray-400">No reservation</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                              {table.features && table.features.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {table.features.map((feature: string, index: number) => (
                                    <Badge key={index} variant="outline" className="text-xs">
                                      {feature}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-gray-400">None</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <div className="flex justify-end space-x-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleContextAction('edit', table, selectedTime)}
                                  className="text-blue-600 hover:text-blue-900"
                                >
                                  <Edit2 size={16} />
                                </Button>
                                {table.reservation && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleContextAction('cancel', table, selectedTime)}
                                    className="text-red-600 hover:text-red-900"
                                  >
                                    <Trash2 size={16} />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                            No tables available for the selected date and time
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { apiRequest, invalidateReservationQueries } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Calendar, Clock, Plus, Settings, MoreVertical, MousePointer2, Edit2, Trash2, AlertCircle, CheckCircle, RefreshCw } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertTableSchema, type InsertTable } from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const restaurantId = 1;

interface TableData {
  id: number;
  name: string;
  minGuests: number;
  maxGuests: number;
  status: string;
  features?: string[];
  reservation?: {
    id: number;
    guestName: string;
    guestCount: number;
    timeSlot: string;
    phone: string;
    status: string;
  };
}

interface ScheduleSlot {
  time: string;
  tables: TableData[];
}

export default function ModernTables() {
  // Get current Moscow time
  const getMoscowDate = () => {
    const now = new Date();
    const moscowTime = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Moscow"}));
    return moscowTime;
  };

  const [selectedDate, setSelectedDate] = useState(format(getMoscowDate(), 'yyyy-MM-dd'));
  const [selectedTime, setSelectedTime] = useState("19:00");
  const [activeView, setActiveView] = useState<"schedule" | "floorplan" | "grid" | "list">("schedule");
  const [showAddTableModal, setShowAddTableModal] = useState(false);
  const [editingTable, setEditingTable] = useState<TableData | null>(null);
  const [draggedTable, setDraggedTable] = useState<{tableId: number; time: string; tableName: string} | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch restaurant operating hours
  const { data: restaurant, isLoading: restaurantLoading } = useQuery({
    queryKey: ["/api/restaurants/profile"],
  });

  // Generate time slots based on restaurant hours (showing every hour for compact view)
  const timeSlots: string[] = [];
  if (restaurant) {
    const openingTime = restaurant.openingTime || "10:00";
    const closingTime = restaurant.closingTime || "22:00";

    const [openHour, openMin] = openingTime.split(':').map(Number);
    const [closeHour, closeMin] = closingTime.split(':').map(Number);

    let currentHour = openHour;
    let currentMin = openMin;

    // Show every hour instead of every 30 minutes for compact view
    while (currentHour < closeHour || (currentHour === closeHour && currentMin < closeMin)) {
      const timeStr = `${currentHour.toString().padStart(2, '0')}:${currentMin.toString().padStart(2, '0')}`;
      timeSlots.push(timeStr);

      currentHour += 1; // Increment by 1 hour instead of 30 minutes
    }
  }

  // Fetch all tables for floor plan view
  const { data: allTables, isLoading: tablesLoading } = useQuery({
    queryKey: [`/api/tables?restaurantId=${restaurantId}`],
  });

  // Fetch table availability for all time slots with enhanced error handling
  const { data: scheduleData, isLoading, error, refetch } = useQuery({
    queryKey: ["/api/tables/availability/schedule", selectedDate],
    queryFn: async () => {
      const promises = timeSlots.map(async (time) => {
        try {
          const response = await fetch(`/api/tables/availability?date=${selectedDate}&time=${time}`, {
            credentials: "include"
          });

          if (!response.ok) {
            throw new Error(`Failed to fetch availability for ${time}`);
          }

          const data = await response.json();
          // Sort tables by ID to maintain consistent positioning
          const sortedTables = data.sort((a: any, b: any) => a.id - b.id);
          return { time, tables: sortedTables };
        } catch (error) {
          console.error(`Error fetching availability for ${time}:`, error);
          return { time, tables: [] };
        }
      });

      const results = await Promise.allSettled(promises);
      return results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => (result as PromiseFulfilledResult<ScheduleSlot>).value);
    },
    enabled: !!restaurant && timeSlots.length > 0 && activeView === 'schedule',
    refetchInterval: activeView === 'schedule' ? 30000 : false, // Only auto-refresh schedule view
    retry: 2,
    retryDelay: 1000,
  });

  // Fetch time-specific table availability for grid/list views
  const { data: timeSpecificTables, isLoading: availabilityLoading } = useQuery({
    queryKey: ["/api/tables/availability", selectedDate, selectedTime],
    queryFn: async () => {
      const response = await fetch(`/api/tables/availability?date=${selectedDate}&time=${selectedTime}`, {
        credentials: "include"
      });
      if (!response.ok) throw new Error('Failed to fetch availability');
      return response.json();
    },
    enabled: (activeView === 'grid' || activeView === 'list') && !!selectedDate && !!selectedTime,
  });

  // Status colors for modern design with enhanced visual feedback
  const getStatusStyle = (status: string, hasReservation: boolean) => {
    if (hasReservation) {
      return "bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25 hover:shadow-red-500/40 transition-all duration-300";
    }

    switch (status) {
      case 'available':
        return "bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg shadow-green-500/25 hover:shadow-green-500/40 transition-all duration-300";
      case 'occupied':
        return "bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25 hover:shadow-red-500/40 transition-all duration-300";
      case 'reserved':
        return "bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 transition-all duration-300";
      case 'maintenance':
        return "bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-300";
      default:
        return "bg-gradient-to-r from-gray-400 to-gray-500 text-white shadow-lg shadow-gray-400/25 hover:shadow-gray-400/40 transition-all duration-300";
    }
  };

  // Enhanced cancel reservation mutation with better error handling
  const cancelReservationMutation = useMutation({
    mutationFn: async (reservationId: number) => {
      const response = await apiRequest("POST", `/api/booking/cancel/${reservationId}`, {});
      return response.json();
    },
    onSuccess: (data, reservationId) => {
      // ✅ Use new smart invalidation utility
      invalidateReservationQueries();

      toast({ 
        title: "Reservation Cancelled", 
        description: "Table is now available for new bookings",
        duration: 4000
      });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to cancel reservation", 
        variant: "destructive" 
      });
    }
  });

  // Create table mutation
  const createTableMutation = useMutation({
    mutationFn: async (tableData: InsertTable) => {
      const response = await apiRequest("POST", "/api/tables", {
        ...tableData,
        restaurantId
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Table Created",
        description: `Table ${data.name} has been created successfully`,
      });

      // ✅ Use smart invalidation for table-related queries
      invalidateReservationQueries();
      queryClient.invalidateQueries({ queryKey: ['/api/tables'] });

      setShowAddTableModal(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error Creating Table",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Update table mutation
  const updateTableMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertTable> }) => {
      const response = await apiRequest("PATCH", `/api/tables/${id}`, data);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Table Updated",
        description: `Table ${data.name} has been updated successfully`,
      });

      invalidateReservationQueries();
      queryClient.invalidateQueries({ queryKey: ['/api/tables'] });

      setEditingTable(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error Updating Table",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Enhanced context menu actions with better UX
  const handleContextAction = async (action: string, table: TableData, time: string) => {
    try {
      const timeDisplay = format(new Date(`2000-01-01T${time}`), 'h:mm a');

      switch (action) {
        case 'cancel':
          if (table.reservation?.id) {
            await cancelReservationMutation.mutateAsync(table.reservation.id);
          } else {
            toast({ 
              title: "No Reservation", 
              description: "No reservation found to cancel",
              variant: "destructive"
            });
          }
          break;

        case 'block':
          // Block table logic - in a real app, this would call an API
          toast({ 
            title: "Table Blocked", 
            description: `${table.name} blocked for ${timeDisplay}`,
            duration: 3000
          });
          invalidateReservationQueries();
          break;

        case 'available':
          toast({ 
            title: "Table Available", 
            description: `${table.name} set as available for ${timeDisplay}`,
            duration: 3000
          });
          invalidateReservationQueries();
          break;

        case 'maintenance':
          toast({ 
            title: "Maintenance Mode", 
            description: `${table.name} set to maintenance for ${timeDisplay}`,
            duration: 3000
          });
          invalidateReservationQueries();
          break;

        case 'reserve':
          toast({ 
            title: "Quick Reservation", 
            description: `Creating reservation for ${table.name} at ${timeDisplay}`,
            duration: 3000
          });
          // In a real app, this would open a reservation modal
          break;

        case 'edit':
          setEditingTable(table);
          break;
      }
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update table status", 
        variant: "destructive" 
      });
    }
  };

  // Enhanced drag and drop handlers for both schedule and floor plan
  const handleDragStart = (e: React.DragEvent, table: TableData, time?: string) => {
    if (activeView === 'schedule' && time) {
      // Schedule view - drag time slots
      const dragData = {
        tableId: table.id,
        time: time,
        tableName: table.name
      };

      setDraggedTable(dragData);
      e.dataTransfer.setData('table', JSON.stringify(dragData));
      e.dataTransfer.effectAllowed = 'move';
    } else if (activeView === 'floorplan') {
      // Floor plan view - drag table positions
      const dragData = {
        tableId: table.id,
        tableName: table.name,
        currentPosition: { x: dragPosition.x, y: dragPosition.y }
      };

      e.dataTransfer.setData('floorplan-table', JSON.stringify(dragData));
      e.dataTransfer.effectAllowed = 'move';
    }

    // Visual feedback
    e.currentTarget.classList.add('opacity-50');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('opacity-50');
    setDraggedTable(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetTable?: TableData, targetTime?: string) => {
    e.preventDefault();

    try {
      if (activeView === 'schedule') {
        // Schedule view drop logic
        const data = JSON.parse(e.dataTransfer.getData('table'));

        if (targetTable && targetTime && (data.tableId !== targetTable.id || data.time !== targetTime)) {
          toast({
            title: "Table Rearranged",
            description: `${data.tableName} moved to ${targetTable.name}'s position at ${format(new Date(`2000-01-01T${targetTime}`), 'h:mm a')}`,
            duration: 3000
          });

          console.log('🔄 Table rearrangement:', {
            from: { table: data.tableName, time: data.time },
            to: { table: targetTable.name, time: targetTime }
          });
        }
      } else if (activeView === 'floorplan') {
        // Floor plan view drop logic
        const data = JSON.parse(e.dataTransfer.getData('floorplan-table'));
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setDragPosition({ x, y });

        toast({
          title: "Table Moved",
          description: `${data.tableName} repositioned on floor plan`,
          duration: 3000
        });

        // In a real app, this would save the new position to the database
        console.log('🏢 Floor plan update:', {
          tableId: data.tableId,
          tableName: data.tableName,
          newPosition: { x, y }
        });
      }
    } catch (error) {
      console.error('Drop error:', error);
    }
  };

  // Get table status colors
  const getTableStatusColor = (status: string) => {
    switch (status) {
      case 'free':
        return "bg-green-100 text-green-800 border-green-200";
      case 'occupied':
        return "bg-red-100 text-red-800 border-red-200";
      case 'reserved':
        return "bg-amber-100 text-amber-800 border-amber-200";
      case 'unavailable':
        return "bg-gray-100 text-gray-800 border-gray-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  if (restaurantLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-6 w-6 animate-spin text-primary" />
            <span>Loading restaurant information...</span>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="max-w-7xl mx-auto p-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load table availability. Please try refreshing the page.
              <Button 
                variant="outline" 
                size="sm" 
                className="ml-4"
                onClick={() => refetch()}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-8">
        {/* Modern Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
              Tables Management
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Intelligent table scheduling and availability management
            </p>
            <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Moscow Time: {format(getMoscowDate(), 'PPP p')}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <Dialog open={showAddTableModal} onOpenChange={setShowAddTableModal}>
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25 transition-all duration-200">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Table
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Table</DialogTitle>
                </DialogHeader>
                <TableForm 
                  onSubmit={async (data) => {
                    await createTableMutation.mutateAsync(data);
                  }}
                  isLoading={createTableMutation.isPending}
                />
              </DialogContent>
            </Dialog>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="outline" 
                  className="border-gray-300 hover:bg-gray-50 transition-all duration-200"
                  onClick={() => refetch()}
                  disabled={isLoading}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Refresh table availability data
              </TooltipContent>
            </Tooltip>

            <Button variant="outline" className="border-gray-300 hover:bg-gray-50 transition-all duration-200">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
          </div>
        </div>

        {/* Sleek Date Selection */}
        <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 rounded-3xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl shadow-lg">
              <Calendar className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Schedule Overview</h2>
              <p className="text-gray-500 dark:text-gray-400">Select date to view real-time availability</p>
            </div>
          </div>

          {/* Quick Date Shortcuts */}
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <div className="flex gap-2">
              {[
                { label: "Today", value: format(getMoscowDate(), 'yyyy-MM-dd') },
                { label: "Tomorrow", value: format(addDays(getMoscowDate(), 1), 'yyyy-MM-dd') },
                { label: "This Weekend", value: format(addDays(getMoscowDate(), 6 - getMoscowDate().getDay()), 'yyyy-MM-dd') }
              ].map((option) => (
                <Button
                  key={option.label}
                  variant={selectedDate === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedDate(option.value)}
                  className="rounded-full px-6 py-2 text-sm font-medium transition-all duration-300 hover:scale-105 shadow-sm"
                >
                  {option.label}
                </Button>
              ))}
            </div>

            {/* Elegant Date Selector */}
            <div className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-2xl px-4 py-3 shadow-lg border border-gray-200/50 dark:border-gray-700/50 hover:shadow-xl transition-all duration-300">
              <Calendar className="h-5 w-5 text-gray-400" />
              <Select value={selectedDate} onValueChange={setSelectedDate}>
                <SelectTrigger className="border-0 shadow-none focus:ring-0 w-48 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-2xl shadow-2xl border-0 bg-white dark:bg-gray-800 p-2">
                  {Array.from({ length: 30 }, (_, i) => {
                    const date = addDays(getMoscowDate(), i);
                    const dateValue = format(date, 'yyyy-MM-dd');
                    let label;

                    if (i === 0) {
                      label = `Today, ${format(date, 'MMM dd')}`;
                    } else if (i === 1) {
                      label = `Tomorrow, ${format(date, 'MMM dd')}`;
                    } else {
                      label = format(date, 'EEE, MMM dd');
                    }

                    return (
                      <SelectItem key={dateValue} value={dateValue} className="rounded-xl hover:bg-gradient-to-r hover:from-blue-50 hover:to-purple-50 dark:hover:from-blue-900/20 dark:hover:to-purple-900/20 transition-all duration-200">
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Beautiful Schedule Grid */}
        <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 rounded-3xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
          <div className="p-6 border-b border-gray-200/50 dark:border-gray-700/50">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  Restaurant Schedule - {format(new Date(selectedDate), 'EEEE, MMMM d, yyyy')}
                </h3>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                  Real-time availability across all tables • Auto-refreshes every 30 seconds
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                )}
                <Badge variant="outline" className="text-xs">
                  Showing hourly slots
                </Badge>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              {/* Compact Sticky Header */}
              <div className="sticky top-0 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-750 border-b border-gray-200/50 dark:border-gray-700/50 px-4 py-2 z-10">
                <div className="flex">
                  <div className="w-20 flex-shrink-0 font-semibold text-gray-700 dark:text-gray-300 text-xs py-2">TIME</div>
                  <div className="flex overflow-x-auto gap-1 flex-1">
                    {scheduleData?.[0]?.tables?.map((table: TableData) => (
                      <div key={table.id} className="w-24 flex-shrink-0 text-center bg-white/50 dark:bg-gray-700/50 rounded-lg p-1.5 border border-gray-200/50 dark:border-gray-600/50">
                        <div className="font-semibold text-gray-900 dark:text-white text-xs">{table.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {table.minGuests}-{table.maxGuests}p
                        </div>
                        {table.features && table.features.length > 0 && (
                          <div className="text-xs text-blue-600 dark:text-blue-400 truncate">
                            {table.features[0]}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Ultra Compact Schedule Rows - Hourly slots */}
              <div className="divide-y divide-gray-200/30 dark:divide-gray-700/30">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="flex items-center gap-3">
                      <RefreshCw className="h-6 w-6 animate-spin text-primary" />
                      <span className="text-lg">Loading schedule...</span>
                    </div>
                  </div>
                ) : scheduleData && scheduleData.length > 0 ? (
                  scheduleData.map((slot: ScheduleSlot, rowIndex: number) => (
                    <div key={slot.time} className={`px-4 py-1.5 transition-all duration-200 hover:bg-gradient-to-r hover:from-blue-50/30 hover:to-purple-50/30 dark:hover:from-blue-900/10 dark:hover:to-purple-900/10 ${rowIndex % 2 === 0 ? 'bg-gray-50/30 dark:bg-gray-800/30' : 'bg-white dark:bg-gray-900'}`}>
                      <div className="flex items-center">
                        <div className="w-20 flex-shrink-0 font-medium text-gray-900 dark:text-white text-xs">
                          {format(new Date(`2000-01-01T${slot.time}`), 'h:mm a')}
                        </div>
                        <div className="flex gap-1 overflow-x-auto flex-1">
                          {slot.tables?.map((table: TableData) => {
                            const hasReservation = table.reservation;
                            return (
                              <ContextMenu key={table.id}>
                                <ContextMenuTrigger>
                                  <div
                                    className={`
                                      w-24 flex-shrink-0 relative cursor-pointer rounded-lg p-1.5 text-center text-xs font-medium transition-all duration-300 hover:scale-105 hover:shadow-lg group
                                      ${getStatusStyle(table.status, !!hasReservation)}
                                    `}
                                    draggable={true}
                                    onDragStart={(e) => handleDragStart(e, table, slot.time)}
                                    onDragEnd={handleDragEnd}
                                    onDragOver={handleDragOver}
                                    onDrop={(e) => handleDrop(e, table, slot.time)}
                                  >
                                    {hasReservation ? (
                                      <div>
                                        <div className="font-semibold text-xs">📅</div>
                                        <div className="text-xs opacity-90 truncate">
                                          {table.reservation.guestName}
                                        </div>
                                        <div className="text-xs opacity-75">
                                          {table.reservation.guestCount}p
                                        </div>
                                      </div>
                                    ) : (
                                      <div>
                                        <div className="font-semibold text-xs">
                                          {table.status === 'maintenance' ? '🔧' : 
                                           table.status === 'unavailable' ? '🚫' : '✓'}
                                        </div>
                                        <div className="text-xs opacity-90 capitalize">
                                          {table.status === 'available' ? 'Free' : table.status}
                                        </div>
                                      </div>
                                    )}

                                    {/* Hover indicator */}
                                    <div className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <MoreVertical className="h-3 w-3" />
                                    </div>
                                  </div>
                                </ContextMenuTrigger>
                                <ContextMenuContent className="rounded-xl shadow-2xl border-0 bg-white dark:bg-gray-800 p-2 min-w-48">
                                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground border-b mb-1">
                                    {table.name} at {format(new Date(`2000-01-01T${slot.time}`), 'h:mm a')}
                                  </div>

                                  {hasReservation ? (
                                    <>
                                      <ContextMenuItem 
                                        onClick={() => handleContextAction('cancel', table, slot.time)}
                                        className="rounded-lg hover:bg-gradient-to-r hover:from-red-50 hover:to-pink-50 dark:hover:from-red-900/20 dark:hover:to-pink-900/20 text-red-600 dark:text-red-400"
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Cancel Reservation
                                      </ContextMenuItem>
                                      <ContextMenuSeparator />
                                    </>
                                  ) : (
                                    <ContextMenuItem 
                                      onClick={() => handleContextAction('reserve', table, slot.time)}
                                      className="rounded-lg hover:bg-gradient-to-r hover:from-green-50 hover:to-emerald-50 dark:hover:from-green-900/20 dark:hover:to-emerald-900/20"
                                    >
                                      <Plus className="h-4 w-4 mr-2" />
                                      Create Reservation
                                    </ContextMenuItem>
                                  )}

                                  <ContextMenuItem 
                                    onClick={() => handleContextAction('available', table, slot.time)}
                                    className="rounded-lg hover:bg-gradient-to-r hover:from-blue-50 hover:to-cyan-50 dark:hover:from-blue-900/20 dark:hover:to-cyan-900/20"
                                  >
                                    <CheckCircle className="h-4 w-4 mr-2" />
                                    Make Available
                                  </ContextMenuItem>

                                  <ContextMenuItem 
                                    onClick={() => handleContextAction('block', table, slot.time)}
                                    className="rounded-lg hover:bg-gradient-to-r hover:from-red-50 hover:to-pink-50 dark:hover:from-red-900/20 dark:hover:to-pink-900/20"
                                  >
                                    <AlertCircle className="h-4 w-4 mr-2" />
                                    Block Table
                                  </ContextMenuItem>

                                  <ContextMenuItem 
                                    onClick={() => handleContextAction('maintenance', table, slot.time)}
                                    className="rounded-lg hover:bg-gradient-to-r hover:from-amber-50 hover:to-yellow-50 dark:hover:from-amber-900/20 dark:hover:to-yellow-900/20"
                                  >
                                    <Settings className="h-4 w-4 mr-2" />
                                    Set Maintenance
                                  </ContextMenuItem>

                                  <ContextMenuSeparator />

                                  <ContextMenuItem 
                                    onClick={() => handleContextAction('edit', table, slot.time)}
                                    className="rounded-lg hover:bg-gradient-to-r hover:from-gray-50 hover:to-gray-100 dark:hover:from-gray-800 dark:hover:to-gray-700"
                                  >
                                    <Edit2 className="h-4 w-4 mr-2" />
                                    Edit Table
                                  </ContextMenuItem>
                                </ContextMenuContent>
                              </ContextMenu>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                        No Schedule Data Available
                      </h3>
                      <p className="text-gray-500 dark:text-gray-400 mb-4">
                        Unable to load table availability for this date.
                      </p>
                      <Button onClick={() => refetch()} variant="outline">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Try Again
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Status Legend and Help Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Status Legend */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-2xl p-6 border border-blue-200/50 dark:border-blue-700/50">
            <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-4 flex items-center gap-2">
              <Badge className="w-3 h-3 rounded-full bg-blue-600" />
              Table Status Legend
            </h4>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-6 bg-gradient-to-r from-emerald-500 to-green-600 rounded text-white text-xs flex items-center justify-center">✓</div>
                <span className="text-sm text-blue-700 dark:text-blue-300">Available - Ready for new reservations</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-6 bg-gradient-to-r from-red-500 to-red-600 rounded text-white text-xs flex items-center justify-center">📅</div>
                <span className="text-sm text-blue-700 dark:text-blue-300">Reserved - Confirmed reservation</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-6 bg-gradient-to-r from-amber-500 to-orange-600 rounded text-white text-xs flex items-center justify-center">⏰</div>
                <span className="text-sm text-blue-700 dark:text-blue-300">Occupied - Currently in use</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-6 bg-gradient-to-r from-purple-500 to-purple-600 rounded text-white text-xs flex items-center justify-center">🔧</div>
                <span className="text-sm text-blue-700 dark:text-blue-300">Maintenance - Under maintenance</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-6 bg-gradient-to-r from-gray-400 to-gray-500 rounded text-white text-xs flex items-center justify-center">🚫</div>
                <span className="text-sm text-blue-700 dark:text-blue-300">Unavailable - Not bookable</span>
              </div>
            </div>
          </div>

          {/* Quick Actions Help */}
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-2xl p-6 border border-green-200/50 dark:border-green-700/50">
            <h4 className="font-semibold text-green-900 dark:text-green-100 mb-4 flex items-center gap-2">
              <MousePointer2 className="h-4 w-4" />
              Quick Actions
            </h4>
            <div className="space-y-3 text-sm text-green-700 dark:text-green-300">
              <div className="flex items-start gap-2">
                <span className="font-medium">Right-click:</span>
                <span>Access context menu for reservations and table management</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-medium">Drag & Drop:</span>
                <span>Rearrange table positions or swap time slots</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-medium">Auto-refresh:</span>
                <span>Data updates every 30 seconds automatically</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-medium">Smart view:</span>
                <span>Hourly slots for compact, efficient scheduling</span>
              </div>
            </div>
          </div>
        </div>

        {/* Table Edit Modal */}
        <Dialog open={!!editingTable} onOpenChange={(open) => !open && setEditingTable(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Table - {editingTable?.name}</DialogTitle>
            </DialogHeader>
            {editingTable && (
              <TableForm 
                table={editingTable}
                onSubmit={async (data) => {
                  await updateTableMutation.mutateAsync({
                    id: editingTable.id,
                    data
                  });
                }}
                isLoading={updateTableMutation.isPending}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

// Enhanced Table Form Component
interface TableFormProps {
  table?: TableData;
  onSubmit: (data: InsertTable) => Promise<void>;
  isLoading?: boolean;
}

function TableForm({ table, onSubmit, isLoading }: TableFormProps) {
  const form = useForm<InsertTable>({
    resolver: zodResolver(insertTableSchema),
    defaultValues: {
      name: table?.name || "",
      minGuests: table?.minGuests || 2,
      maxGuests: table?.maxGuests || 4,
      comments: table?.comments || "",
      features: table?.features || [],
      restaurantId: restaurantId,
    },
  });

  const handleSubmit = async (data: InsertTable) => {
    try {
      await onSubmit(data);
      form.reset();
    } catch (error) {
      // Error handling is done in the mutation
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Table Name</FormLabel>
              <FormControl>
                <Input placeholder="Table 1, Window Table, etc." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="minGuests"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Min Guests</FormLabel>
                <FormControl>
                  <Input 
                    type="number" 
                    {...field} 
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="maxGuests"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Max Guests</FormLabel>
                <FormControl>
                  <Input 
                    type="number" 
                    {...field} 
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 4)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="comments"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Comments</FormLabel>
              <FormControl>
                <Input placeholder="Window section, Patio, etc." {...field} value={field.value || ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter className="gap-2">
          <Button 
            type="submit" 
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" />
                {table ? "Updating..." : "Creating..."}
              </div>
            ) : (
              table ? "Update Table" : "Create Table"
            )}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}